import { WebSocketTransport } from "@colyseus/ws-transport";
import { describe, expect, it } from "vitest";
import { createPrefixedMatchmakerRouter } from "../src/prefixed-matchmaker.js";

describe("prefixed matchmaking router", () => {
  it("exposes matchmaking below the single-origin /play prefix", () => {
    const router = createPrefixedMatchmakerRouter("/play", new WebSocketTransport());
    expect(router.findRoute(
      "POST",
      "/play/matchmake/joinOrCreate/g_0123456789abcdef0123456789abcdef",
    )).toBeDefined();
    expect(router.findRoute(
      "POST",
      "/authority/cinder/matchmake/joinOrCreate/game_session",
    )).toBeUndefined();
  });
});
