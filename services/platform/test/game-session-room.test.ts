import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatformServer } from "../src/platform.js";
import type { GameSessionState } from "../src/rooms/game-session-state.js";
import {
  createTestHarness,
  issueTestGameSession,
  TEST_GAMES,
  TWO_SURFACE_LEASES,
} from "./test-harness.js";

describe("game_session room", () => {
  const harness = createTestHarness();
  let colyseus: ColyseusTestServer;

  async function startTestServer(): Promise<ColyseusTestServer> {
    const server = await boot(createPlatformServer(harness.dependencies));
    // The shutdown test restarts this listener on the same port. Do not let
    // Node's shared fetch pool reuse an idle socket from the previous server.
    server.sdk.http.options.headers = { Connection: "close" };
    return server;
  }

  beforeAll(async () => {
    colyseus = await startTestServer();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  it("lets one account connect two surface clients with distinct PlayerSlot leases", async () => {
    const game = TEST_GAMES[0];
    if (game === undefined) {
      throw new Error("sample game missing");
    }
    const bundle = await issueTestGameSession(harness, {
      accountId: "same-account",
      accountSessionId: "same-account-session",
      expiresAt: new Date(Date.now() + 3_600_000),
    }, game, TWO_SURFACE_LEASES);

    const room = await colyseus.createRoom<GameSessionState>("game_session", bundle.joinOptions);
    const upperTicket = bundle.surfaces[0];
    const lowerTicket = bundle.surfaces[1];
    if (upperTicket === undefined || lowerTicket === undefined) {
      throw new Error("surface tickets missing");
    }

    colyseus.sdk.auth.token = upperTicket.ticket;
    const upperClient = await colyseus.connectTo(room, bundle.joinOptions);
    colyseus.sdk.auth.token = lowerTicket.ticket;
    const lowerClient = await colyseus.connectTo(room, bundle.joinOptions);
    await room.waitForNextPatch();

    expect(room.clients).toHaveLength(2);
    expect(room.state.surfaces.size).toBe(2);
    expect(room.state.playerSeats.size).toBe(2);
    expect(room.state.surfaces.get("upper")?.role).toBe("main");
    expect(room.state.surfaces.get("upper")?.playerSlots.toArray()).toEqual([0]);
    expect(room.state.surfaces.get("lower")?.playerSlots.toArray()).toEqual([1]);
    expect(JSON.stringify(room.state.toJSON())).not.toContain("same-account");

    const receivedEvent = lowerClient.waitForMessage("game_event");
    upperClient.send("game_input", {
      playerSlot: 0,
      sequence: 0,
      channel: 1,
      payload: Buffer.from("move:left").toString("base64"),
    });
    await expect(receivedEvent).resolves.toMatchObject({
      playerSlot: 0,
      surfaceId: "upper",
      sequence: 0,
      channel: 1,
    });
  });

  it("rejects a consumed ticket and package-scope mismatch", async () => {
    const game = TEST_GAMES[0];
    if (game === undefined) {
      throw new Error("sample game missing");
    }
    const account = {
      accountId: "account-2",
      accountSessionId: "account-session-2",
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    const bundle = await issueTestGameSession(harness, account, game, [
      { ...TWO_SURFACE_LEASES[0], playerSlots: [0, 1] },
    ]);
    const room = await colyseus.createRoom("game_session", bundle.joinOptions);
    const ticket = bundle.surfaces[0];
    if (ticket === undefined) {
      throw new Error("ticket missing");
    }

    colyseus.sdk.auth.token = ticket.ticket;
    await colyseus.connectTo(room, bundle.joinOptions);
    await expect(colyseus.connectTo(room, bundle.joinOptions)).rejects.toMatchObject({
      code: 4409,
    });

    const otherBundle = await issueTestGameSession(harness, account, game, [
      { ...TWO_SURFACE_LEASES[0], playerSlots: [0, 1] },
    ]);
    const otherTicket = otherBundle.surfaces[0];
    if (otherTicket === undefined) {
      throw new Error("ticket missing");
    }
    colyseus.sdk.auth.token = otherTicket.ticket;
    await expect(colyseus.connectTo(room, {
      ...bundle.joinOptions,
      packageDigest: "0".repeat(64),
    })).rejects.toMatchObject({ code: 403 });

    const otherRoom = await colyseus.createRoom("game_session", otherBundle.joinOptions);
    colyseus.sdk.auth.token = otherTicket.ticket;
    await expect(colyseus.connectTo(otherRoom, otherBundle.joinOptions)).resolves.toBeDefined();
    await expect(colyseus.connectTo(otherRoom, otherBundle.joinOptions)).rejects.toMatchObject({
      code: 4409,
    });
  });

  it("allows exactly one concurrent join for the same verified ticket", async () => {
    const game = TEST_GAMES[0];
    if (game === undefined) throw new Error("sample game missing");
    const bundle = await issueTestGameSession(harness, {
      accountId: "account-concurrent",
      accountSessionId: "account-session-concurrent",
      expiresAt: new Date(Date.now() + 3_600_000),
    }, game, [{ ...TWO_SURFACE_LEASES[0], playerSlots: [0, 1] }]);
    const room = await colyseus.createRoom<GameSessionState>("game_session", bundle.joinOptions);
    const ticket = bundle.surfaces[0];
    if (ticket === undefined) throw new Error("ticket missing");
    colyseus.sdk.auth.token = ticket.ticket;

    const outcomes = await Promise.allSettled([
      colyseus.connectTo(room, bundle.joinOptions),
      colyseus.connectTo(room, bundle.joinOptions),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected"))
      .toMatchObject({ reason: { code: 4409 } });
    expect(room.state.surfaces.size).toBe(1);
    expect(room.state.playerSeats.size).toBe(2);
  });

  it("binds both surface capabilities to one room and disconnects it after supersession", async () => {
    const game = TEST_GAMES[0];
    if (game === undefined) throw new Error("sample game missing");
    const account = {
      accountId: "account-room-fence",
      accountSessionId: "account-session-room-fence",
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    const bundle = await issueTestGameSession(harness, account, game, TWO_SURFACE_LEASES);
    const firstRoom = await colyseus.createRoom<GameSessionState>("game_session", bundle.joinOptions);
    const splitRoom = await colyseus.createRoom<GameSessionState>("game_session", bundle.joinOptions);
    const upperTicket = bundle.surfaces[0];
    const lowerTicket = bundle.surfaces[1];
    if (upperTicket === undefined || lowerTicket === undefined) throw new Error("ticket missing");

    colyseus.sdk.auth.token = upperTicket.ticket;
    const upperClient = await colyseus.connectTo(firstRoom, bundle.joinOptions);
    colyseus.sdk.auth.token = lowerTicket.ticket;
    await expect(colyseus.connectTo(splitRoom, bundle.joinOptions)).rejects.toMatchObject({
      code: 403,
    });
    const lowerClient = await colyseus.connectTo(firstRoom, bundle.joinOptions);
    await firstRoom.waitForNextPatch();
    expect(firstRoom.state.surfaces.size).toBe(2);
    expect(splitRoom.state.surfaces.size).toBe(0);

    const upperLeft = new Promise<number>((resolve) => upperClient.onLeave(resolve));
    const lowerLeft = new Promise<number>((resolve) => lowerClient.onLeave(resolve));
    await issueTestGameSession(harness, account, game, TWO_SURFACE_LEASES);
    await expect(upperLeft).resolves.toBe(4_410);
    await expect(lowerLeft).resolves.toBe(4_410);
  });

  it("rejects another Game Session before consuming its valid surface capability", async () => {
    const game = TEST_GAMES[0];
    if (game === undefined) throw new Error("sample game missing");
    const expiresAt = new Date(Date.now() + 3_600_000);
    const firstBundle = await issueTestGameSession(harness, {
      accountId: "room-scope-account-a",
      accountSessionId: "room-scope-session-a",
      expiresAt,
    }, game, [{ surfaceId: "surface-a", role: "main", playerSlots: [0] }]);
    const otherBundle = await issueTestGameSession(harness, {
      accountId: "room-scope-account-b",
      accountSessionId: "room-scope-session-b",
      expiresAt,
    }, game, [{ surfaceId: "surface-b", role: "main", playerSlots: [1] }]);
    const firstTicket = firstBundle.surfaces[0];
    const otherTicket = otherBundle.surfaces[0];
    if (firstTicket === undefined || otherTicket === undefined) throw new Error("ticket missing");

    const firstRoom = await colyseus.createRoom<GameSessionState>(
      "game_session",
      firstBundle.joinOptions,
    );
    colyseus.sdk.auth.token = firstTicket.ticket;
    await colyseus.connectTo(firstRoom, firstBundle.joinOptions);

    colyseus.sdk.auth.token = otherTicket.ticket;
    await expect(colyseus.connectTo(firstRoom, otherBundle.joinOptions)).rejects.toMatchObject({
      code: 403,
    });
    expect(firstRoom.state.gameSessionId).toBe(firstBundle.gameSessionId);
    expect(firstRoom.state.surfaces.has("surface-b")).toBe(false);

    const otherRoom = await colyseus.createRoom<GameSessionState>(
      "game_session",
      otherBundle.joinOptions,
    );
    colyseus.sdk.auth.token = otherTicket.ticket;
    await expect(colyseus.connectTo(otherRoom, otherBundle.joinOptions)).resolves.toBeDefined();
    expect(otherRoom.state.gameSessionId).toBe(otherBundle.gameSessionId);
    expect(otherRoom.state.surfaces.has("surface-b")).toBe(true);
  });

  it("shuts down cleanly while a Surface Client is connected", async () => {
    const game = TEST_GAMES[0];
    if (game === undefined) throw new Error("sample game missing");
    const bundle = await issueTestGameSession(harness, {
      accountId: "shutdown-account",
      accountSessionId: "shutdown-account-session",
      expiresAt: new Date(Date.now() + 3_600_000),
    }, game, [{ surfaceId: "shutdown-surface", role: "main", playerSlots: [0] }]);
    const ticket = bundle.surfaces[0];
    if (ticket === undefined) throw new Error("ticket missing");
    const room = await colyseus.createRoom<GameSessionState>("game_session", bundle.joinOptions);
    colyseus.sdk.auth.token = ticket.ticket;
    await colyseus.connectTo(room, bundle.joinOptions);

    const reportedErrors: unknown[][] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      reportedErrors.push(args);
    });
    try {
      await colyseus.shutdown();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(reportedErrors.flat().map(String).join("\n")).not.toContain("disposing");
    } finally {
      errorSpy.mockRestore();
      colyseus = await startTestServer();
    }
  });

  it("accepts 32768 decoded payload bytes and rejects 32769", async () => {
    const game = TEST_GAMES[0];
    if (game === undefined) throw new Error("sample game missing");
    const bundle = await issueTestGameSession(harness, {
      accountId: "account-payload",
      accountSessionId: "account-session-payload",
      expiresAt: new Date(Date.now() + 3_600_000),
    }, game, TWO_SURFACE_LEASES);
    const room = await colyseus.createRoom<GameSessionState>("game_session", bundle.joinOptions);
    const upperTicket = bundle.surfaces[0];
    const lowerTicket = bundle.surfaces[1];
    if (upperTicket === undefined || lowerTicket === undefined) throw new Error("ticket missing");

    colyseus.sdk.auth.token = upperTicket.ticket;
    const upperClient = await colyseus.connectTo(room, bundle.joinOptions);
    colyseus.sdk.auth.token = lowerTicket.ticket;
    const lowerClient = await colyseus.connectTo(room, bundle.joinOptions);

    const acceptedEvent = lowerClient.waitForMessage("game_event");
    upperClient.send("game_input", {
      playerSlot: 0,
      sequence: 0,
      channel: 1,
      payload: Buffer.alloc(32_768).toString("base64"),
    });
    await expect(acceptedEvent).resolves.toMatchObject({ sequence: 0 });

    const rejected = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("oversized payload was not rejected")), 500);
      upperClient.onLeave((code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    upperClient.send("game_input", {
      playerSlot: 0,
      sequence: 1,
      channel: 1,
      payload: Buffer.alloc(32_769).toString("base64"),
    });
    await expect(rejected).resolves.toBeGreaterThan(0);
  });
});
