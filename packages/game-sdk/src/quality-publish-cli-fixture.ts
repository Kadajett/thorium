import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLATFORM_URL } from "./quality-publish-package-fixture.js";
interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}
function exitCode(error: unknown): number {
  if (typeof error !== "object" || error === null || !("code" in error)) return 0;
  return typeof error.code === "number" ? error.code : 0;
}
export function runWithoutToken(manifestPath: string): Promise<CliResult> {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const environment = { ...process.env };
  delete environment.THORIUM_PUBLISH_TOKEN;
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, "publish", manifestPath, "--platform", PLATFORM_URL],
      { env: environment },
      (error, stdout, stderr) => {
        resolve({ code: exitCode(error), stdout, stderr });
      },
    );
  });
}
