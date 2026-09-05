import type { Application } from "express";
import { z } from "zod";
import type { DeviceAccountIdentityPort } from "../ports/account-identity.js";

const DeviceSessionRequestSchema = z.strictObject({
  credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export function registerDeviceAccountRoutes(
  app: Application,
  identity: DeviceAccountIdentityPort,
): void {
  app.post("/v1/device-sessions", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const parsed = DeviceSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: "invalid_device_credential",
          message: "A canonical 256-bit device credential is required.",
        },
        path: request.path,
      });
      return;
    }
    try {
      const authorization = await identity.issueForDeviceCredential(parsed.data.credential);
      response.status(201).json({
        token: authorization.token,
        expiresAt: authorization.expiresAt.toISOString(),
      });
    } catch {
      response.status(400).json({
        error: {
          code: "invalid_device_credential",
          message: "A canonical 256-bit device credential is required.",
        },
        path: request.path,
      });
    }
  });
}
