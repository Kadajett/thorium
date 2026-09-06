import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseApkBadging, updateManifest, verifyAndroidReleaseTag } from "./core/manifest.mts";

function apkIdentity(apkPath: string) {
  const sdkDirectory = process.env["ANDROID_HOME"];
  if (sdkDirectory === undefined) throw new Error("ANDROID_HOME is required");
  const aapt = join(sdkDirectory, "build-tools", "36.0.0", "aapt");
  const badging = execFileSync(aapt, ["dump", "badging", apkPath], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return parseApkBadging(badging);
}

async function apkBytes(apkPath: string) {
  const metadata = await stat(apkPath);
  if (!metadata.isFile() || metadata.size > 256 * 1024 * 1024) {
    throw new Error("APK is not a bounded regular file");
  }
  return readFile(apkPath);
}

async function generate(): Promise<void> {
  const [apkPath, outputPath] = process.argv.slice(2);
  if (apkPath === undefined || outputPath === undefined) {
    throw new Error("Usage: generate.mts APK_PATH OUTPUT_JSON");
  }
  const identity = apkIdentity(apkPath);
  if (identity.packageId !== "dev.yougotserved.thorium.debug") {
    throw new Error("Refusing update metadata for a non-release verification package");
  }
  if (process.env["GITHUB_REF_TYPE"] === "tag") {
    verifyAndroidReleaseTag(identity, process.env["GITHUB_REF_NAME"] ?? "");
  }
  const requestedTag = process.env["THORIUM_ANDROID_RELEASE_TAG"];
  if (requestedTag !== undefined) verifyAndroidReleaseTag(identity, requestedTag);
  const bytes = await apkBytes(apkPath);
  const manifest = updateManifest(identity, {
    assetName: "thorium-developer-debug.apk",
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
}

await generate();
