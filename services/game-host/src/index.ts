import { loadConfig } from "./config.js";
import { createGameHostRuntime } from "./service.js";

const runtime = await createGameHostRuntime(loadConfig(process.env));
await runtime.listen();
