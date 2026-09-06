import assert from "node:assert/strict";
import test from "node:test";
import { GAME_HOST_API_VERSION } from "./index.js";

await test("exports one stable host API version", () => {
  assert.equal(GAME_HOST_API_VERSION, "thorium-game-host-v1");
});
