import type { Application, Request } from "express";
import { z } from "zod";
import type { SharedGameHostAuthority } from "../security/shared-game-host-authority.js";
import type { GameSessionRegistry } from "../session-registry/game-session-registry.js";

const Release = z.strictObject({
  packageId: z.string().max(128).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
  version: z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
const Fence = z.strictObject({
  gameSessionId: z.string().uuid(),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  roomInstanceId: z.string().min(1).max(128),
  release: Release,
});
const Admission = Fence.extend({
  capabilityId: z.string().uuid(),
  surfaceId: z.string().min(1).max(64),
  role: z.enum(["main", "companion"]),
  playerSlots: z.array(z.number().int().min(0).max(15)).max(16),
}).strict();
const Finish = Fence.extend({
  reason: z.enum(["completed", "abandoned", "room-failed"]),
}).strict();

export function registerGameHostRoutes(
  app: Application,
  authority: SharedGameHostAuthority,
  registry: GameSessionRegistry,
): void {
  function authorize(request: Request): boolean {
    const token = /^Bearer ([^\s]+)$/.exec(request.header("authorization") ?? "")?.[1];
    return token !== undefined && token.length <= 4_096 && authority.authenticateService(token);
  }

  app.post("/v1/game-host/admit", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!authorize(request)) {
      response.status(401).json({ error: "invalid_game_host_service_token" });
      return;
    }
    const body = Admission.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({ error: "invalid_game_host_admission" });
      return;
    }
    const result = await registry.admit(body.data);
    response.status(result.ok ? 200 : 403).json(result);
  });

  app.post("/v1/game-host/fence", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!authorize(request)) {
      response.status(401).json({ error: "invalid_game_host_service_token" });
      return;
    }
    const body = Fence.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({ error: "invalid_game_host_fence" });
      return;
    }
    response.json({ active: await registry.isActive(body.data) });
  });

  app.post("/v1/game-host/finish", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!authorize(request)) {
      response.status(401).json({ error: "invalid_game_host_service_token" });
      return;
    }
    const body = Finish.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({ error: "invalid_game_host_finish" });
      return;
    }
    const result = await registry.finish(body.data);
    response.status(result.ok ? 200 : 409).json(result);
  });
}
