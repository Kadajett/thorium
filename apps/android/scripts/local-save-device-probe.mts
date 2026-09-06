import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// Deliberately targets the private verification app, never the installed public release.
const applicationId = "dev.yougotserved.thorium.rewrite";
const testPackage = `${applicationId}.test`;
const runner = `${testPackage}/androidx.test.runner.AndroidJUnitRunner`;
const testNamespace = "dev.yougotserved.thorium";
const serial = process.env["ANDROID_SERIAL"] ?? "emulator-5554";
const sdkDirectory = process.env["ANDROID_HOME"];
const adbBinary = sdkDirectory === undefined ? "adb" : join(sdkDirectory, "platform-tools", "adb");

function adb(arguments_: readonly string[]): string {
  return execFileSync(adbBinary, ["-s", serial, ...arguments_], {
    encoding: "utf8",
    timeout: 120_000,
  });
}

function instrument(test: string, count: number, extra: readonly string[] = []): void {
  const output = adb([
    "shell",
    "am",
    "instrument",
    "-w",
    "-r",
    "-e",
    "class",
    test,
    ...extra,
    runner,
  ]);
  process.stdout.write(output);
  assert.match(output, new RegExp(`OK \\(${String(count)} tests?\\)`));
  assert.doesNotMatch(output, /FAILURES!!!|INSTRUMENTATION_FAILED/);
}

function main(): void {
  assert.match(adb(["shell", "pm", "path", applicationId]), /^package:/m);
  assert.match(adb(["shell", "pm", "path", testPackage]), /^package:/m);
  instrument(`${testNamespace}.LocalSaveSqliteTest`, 5);
  instrument(`${testNamespace}.LocalSaveBridgeDeviceTest`, 3);
  const nonce = randomUUID();
  const extra = ["-e", "saveProbe", nonce];
  instrument(`${testNamespace}.LocalSaveRestartProbe#writeBeforeProcessRestart`, 1, extra);
  adb(["shell", "am", "force-stop", applicationId]);
  instrument(`${testNamespace}.LocalSaveRestartProbe#readAfterProcessRestart`, 1, extra);
  process.stdout.write(
    "PASS: Android SQLite checks and committed save survived a different process.\n",
  );
}

main();
