import { validateManifest, type WebGameManifest } from "./manifest.js";
import type { GameBootstrap, SurfaceRole } from "./types.js";
import { previewBootstraps } from "./core/preview-bootstrap.js";
import { parseOutbound } from "./core/preview-message.js";
import { previewRoute, type PreviewDelivery } from "./core/preview-routing.js";
export type { PreviewDelivery } from "./core/preview-routing.js";
export interface PreviewConnection {
  readonly manifest: WebGameManifest;
  readonly bootstrap: (role: SurfaceRole) => GameBootstrap;
  readonly route: (source: SurfaceRole, message: unknown) => readonly PreviewDelivery[];
}
export function createPreviewRouter(input: unknown): PreviewConnection {
  const manifest = validateManifest(input);
  const preview = { manifest, bootstraps: previewBootstraps(manifest) };
  return {
    manifest,
    bootstrap: (role) => preview.bootstraps[role],
    route: (source, message) => previewRoute(preview, source, parseOutbound(message)),
  };
}
/** Constructible compatibility facade; preview policy belongs to the readonly core. */
export class PreviewRouter implements PreviewConnection {
  readonly manifest: WebGameManifest;
  readonly #connection: PreviewConnection;
  constructor(input: unknown) {
    this.#connection = createPreviewRouter(input);
    this.manifest = this.#connection.manifest;
  }
  bootstrap(role: SurfaceRole): GameBootstrap {
    return this.#connection.bootstrap(role);
  }
  route(source: SurfaceRole, wireMessage: unknown): readonly PreviewDelivery[] {
    return this.#connection.route(source, wireMessage);
  }
}
