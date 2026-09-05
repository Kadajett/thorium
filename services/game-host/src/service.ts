import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { colyseusPublicAddress, type GameHostConfig } from "./config.js";
import { AdmissionService } from "./admission.js";
import {
  configureColyseusCors,
  createBrowserOriginPolicy,
  createUpgradeGuard,
} from "./browser-origin-policy.js";
import { GameModuleLoader, registerOnServer } from "./module-loader.js";
import { SqliteNonceStore } from "./nonce-store.js";
import { PlatformRegistryClient } from "./registry-client.js";
import { createPrefixedMatchmakerRouter } from "./prefixed-matchmaker.js";

export interface GameHostRuntime {
  readonly server: ReturnType<typeof defineServer>;
  readonly loader: GameModuleLoader;
  readonly listen: () => Promise<void>;
  readonly close: () => Promise<void>;
}

async function requiredTextFile(file: string, label: string): Promise<string> {
  const value = (await readFile(file, "utf8")).trim();
  if (value.length === 0) throw new Error(`${label}_file_empty`);
  return value;
}

export async function createGameHostRuntime(config: GameHostConfig): Promise<GameHostRuntime> {
  await mkdir(config.STATE_DIRECTORY, { recursive: true });
  await mkdir(dirname(config.NONCE_DATABASE_FILE), { recursive: true });
  const [platformPublicKeyPem, moduleSigningPublicKeyPem, transferSecret] = await Promise.all([
    requiredTextFile(config.PLATFORM_ADMISSION_PUBLIC_KEY_FILE, "platform_admission_public_key"),
    requiredTextFile(config.MODULE_SIGNING_PUBLIC_KEY_FILE, "module_signing_public_key"),
    requiredTextFile(config.TRANSFER_SIGNING_SECRET_FILE, "transfer_signing_secret"),
  ]);
  const nonceStore = new SqliteNonceStore(config.NONCE_DATABASE_FILE);
  const admission = new AdmissionService({
    endpoint: config.PUBLIC_ENDPOINT,
    nonceStore,
    platformPublicKeyPem,
    transferSecret,
  });
  await admission.ready();
  const registry = new PlatformRegistryClient({
    endpoint: config.PLATFORM_ENDPOINT,
    serviceTokenFile: config.PLATFORM_SERVICE_TOKEN_FILE,
  });
  const originPolicy = createBrowserOriginPolicy(config.BROWSER_ALLOWED_ORIGINS);
  configureColyseusCors(originPolicy);
  const transport = new WebSocketTransport({
    beforeUpgrade: createUpgradeGuard(originPolicy, config.BASE_PATH),
    maxPayload: 48 * 1_024,
  });
  const health = { scanError: undefined as string | undefined };
  const server = defineServer({
    rooms: {},
    routes: createPrefixedMatchmakerRouter(config.BASE_PATH, transport),
    publicAddress: colyseusPublicAddress(config.PUBLIC_ENDPOINT),
    transport,
    express: (app) => {
      const healthHandler = (_request: unknown, response: {
        status(code: number): typeof response;
        json(value: unknown): void;
      }) => {
        response.status(200).json({ ok: true, modules: loader.loaded.length });
      };
      const readyHandler = (_request: unknown, response: {
        status(code: number): typeof response;
        json(value: unknown): void;
      }) => {
        const ready = health.scanError === undefined;
        response.status(ready ? 200 : 503).json({
          ok: ready,
          modules: loader.loaded.length,
          ...(health.scanError === undefined ? {} : { error: "module_scan_failed" }),
        });
      };
      app.get("/healthz", healthHandler);
      app.get(`${config.BASE_PATH}/healthz`, healthHandler);
      app.get("/readyz", readyHandler);
      app.get(`${config.BASE_PATH}/readyz`, readyHandler);
    },
    greet: false,
  });
  const loader = new GameModuleLoader({
    moduleDirectory: config.MODULE_DIRECTORY,
    stateDirectory: config.STATE_DIRECTORY,
    endpoint: config.PUBLIC_ENDPOINT,
    moduleSigningPublicKeyPem,
    admission,
    registry,
    registerRoom: registerOnServer(server),
  });
  let scanTimer: NodeJS.Timeout | undefined;
  let scanInProgress = false;
  const scan = async (): Promise<void> => {
    if (scanInProgress) return;
    scanInProgress = true;
    try {
      await loader.scan();
      health.scanError = undefined;
    } catch (error) {
      health.scanError = error instanceof Error ? error.message : "unknown_module_scan_failure";
      console.error("game module scan failed", error);
    } finally {
      scanInProgress = false;
    }
  };
  const close = async (): Promise<void> => {
    if (scanTimer !== undefined) clearInterval(scanTimer);
    await loader.dispose();
    nonceStore.close();
  };
  server.onShutdown(close);
  return {
    server,
    loader,
    listen: async () => {
      await loader.scan();
      await server.listen(config.PORT, config.HOST_ADDRESS);
      scanTimer = setInterval(() => void scan(), 5_000);
      scanTimer.unref();
    },
    close,
  };
}
