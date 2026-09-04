import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import {
  AccountSessionExpiringError,
  SessionTicketScopeMismatchError,
  type SessionTicketClaims,
} from "../src/security/session-ticket-service.js";
import {
  createTestHarness,
  issueTestGameSession,
  TEST_GAMES,
  TWO_SURFACE_LEASES,
} from "./test-harness.js";

function admissionFor(claims: SessionTicketClaims, roomInstanceId: string) {
  return {
    gameSessionId: claims.gameSessionId,
    generation: claims.generation,
    roomInstanceId,
    release: {
      packageId: claims.packageId,
      version: claims.packageVersion,
      contentDigest: claims.packageDigest,
    },
    capabilityId: claims.capabilityId,
    surfaceId: claims.surfaceId,
    role: claims.role,
    playerSlots: claims.playerSlots,
  } as const;
}

describe("SessionTicketService", () => {
  it("signs the registry generation and exact surface capability into each ticket", async () => {
    const harness = createTestHarness();
    const game = TEST_GAMES[0];
    if (game === undefined) throw new Error("sample game missing");
    const bundle = await issueTestGameSession(harness, {
      accountId: "account-1",
      accountSessionId: "account-session-1",
      expiresAt: new Date(Date.now() + 60_000),
    }, game, TWO_SURFACE_LEASES);

    const upper = bundle.surfaces[0];
    const lower = bundle.surfaces[1];
    if (upper === undefined || lower === undefined) throw new Error("surface tickets missing");
    const upperClaims = harness.sessionTickets.accept(
      await harness.sessionTickets.verifyScope(upper.ticket, bundle.joinOptions),
    );
    const lowerClaims = harness.sessionTickets.accept(
      await harness.sessionTickets.verifyScope(lower.ticket, bundle.joinOptions),
    );

    expect(upperClaims.accountScope).toBe(lowerClaims.accountScope);
    expect(upperClaims.generation).toBe(1);
    expect(decodeJwt(upper.ticket).jti).toBe(upperClaims.capabilityId);
    expect(upperClaims).toMatchObject({
      gameSessionId: bundle.gameSessionId,
      packageId: game.packageId,
      packageDigest: game.contentDigest,
      surfaceId: "upper",
      role: "main",
      playerSlots: [0],
    });
    expect(JSON.stringify(upperClaims)).not.toContain("account-1");
  });

  it("keeps verification stateless while the registry admits a capability once", async () => {
    const harness = createTestHarness();
    const game = TEST_GAMES[0];
    if (game === undefined) throw new Error("sample game missing");
    const bundle = await issueTestGameSession(harness, {
      accountId: "account-replay",
      accountSessionId: "account-session-replay",
      expiresAt: new Date(Date.now() + 60_000),
    }, game, [TWO_SURFACE_LEASES[0]]);
    const ticket = bundle.surfaces[0];
    if (ticket === undefined) throw new Error("ticket missing");

    const first = harness.sessionTickets.accept(
      await harness.sessionTickets.verifyScope(ticket.ticket, bundle.joinOptions),
    );
    const retry = harness.sessionTickets.accept(
      await harness.sessionTickets.verifyScope(ticket.ticket, bundle.joinOptions),
    );
    expect(retry).toEqual(first);

    const outcomes = await Promise.all([
      harness.gameSessions.admit(admissionFor(first, "room-a")),
      harness.gameSessions.admit(admissionFor(retry, "room-a")),
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)[0]).toMatchObject({
      conflict: { code: "CAPABILITY_REPLAYED" },
    });
  });

  it("rejects exact-scope mismatches and rechecks expiration at admission time", async () => {
    let now = new Date("2026-09-04T12:00:00.000Z");
    const harness = createTestHarness(() => now);
    const game = TEST_GAMES[0];
    if (game === undefined) throw new Error("sample game missing");
    const bundle = await issueTestGameSession(harness, {
      accountId: "account-expiration",
      accountSessionId: "account-session-expiration",
      expiresAt: new Date(now.getTime() + 3_600_000),
    }, game, [TWO_SURFACE_LEASES[0]]);
    const ticket = bundle.surfaces[0];
    if (ticket === undefined) throw new Error("ticket missing");

    await expect(harness.sessionTickets.verifyScope(ticket.ticket, {
      ...bundle.joinOptions,
      packageDigest: "0".repeat(64),
    })).rejects.toBeInstanceOf(SessionTicketScopeMismatchError);

    const pending = await harness.sessionTickets.verifyScope(ticket.ticket, bundle.joinOptions);
    now = new Date(now.getTime() + 61_000);
    expect(() => harness.sessionTickets.accept(pending)).toThrow("session_ticket_expired");
  });

  it("requires ten seconds of Account Session lifetime before activation", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const harness = createTestHarness(() => now);

    expect(() => harness.sessionTickets.prepareIssue({
      accountId: "account-1",
      accountSessionId: "account-session-1",
      expiresAt: new Date(now.getTime() + 9_999),
    })).toThrow(AccountSessionExpiringError);
    expect(() => harness.sessionTickets.prepareIssue({
      accountId: "account-1",
      accountSessionId: "account-session-1",
      expiresAt: new Date(now.getTime() + 10_000),
    })).not.toThrow();
  });
});
