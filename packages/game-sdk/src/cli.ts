#!/usr/bin/env node
import { parseCliArguments } from "./core/cli-arguments.js";
import { runCommand } from "./cli-actions.js";
function usage(): never {
  console.error(
    "Usage:\n" +
      "  thorium-game validate <thorium.json> [--out <descriptor.json>]\n" +
      "  thorium-game pack <thorium.json> [--archive <game.zip>] [--descriptor <descriptor.json>]\n" +
      "  thorium-game serve <thorium.json> [--port <port>]\n" +
      "  thorium-game publish <thorium.json> --platform <https://host>\n" +
      "    Reads the scoped token from THORIUM_PUBLISH_TOKEN.",
  );
  process.exit(2);
}
const command = parseCliArguments(process.argv.slice(2));
if (command === undefined) usage();
runCommand(command).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
