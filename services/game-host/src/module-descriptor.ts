import { z } from "zod";
import { GAME_HOST_API_VERSION } from "@thorium/game-host-api";

const FileName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
const Room = z.strictObject({
  localName: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  kind: z.enum(["account-session", "public-world"]),
  filterBy: z
    .array(z.string().regex(/^[a-z][A-Za-z0-9]{0,47}$/))
    .max(8)
    .default([]),
});

export const ServerModuleDescriptorSchema = z
  .strictObject({
    schema: z.literal(1),
    apiVersion: z.literal(GAME_HOST_API_VERSION),
    release: z.strictObject({
      packageId: z
        .string()
        .max(128)
        .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
      version: z
        .string()
        .max(64)
        .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
      contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    entrypoint: FileName,
    entrypointSha256: z.string().regex(/^[a-f0-9]{64}$/),
    entrypointSizeBytes: z
      .number()
      .int()
      .positive()
      .max(16 * 1_024 * 1_024),
    rooms: z.array(Room).min(1).max(16),
  })
  .superRefine((descriptor, context) => {
    if (new Set(descriptor.rooms.map((room) => room.localName)).size !== descriptor.rooms.length) {
      context.addIssue({ code: "custom", path: ["rooms"], message: "room names must be unique" });
    }
  });

export type ServerModuleDescriptor = z.infer<typeof ServerModuleDescriptorSchema>;
