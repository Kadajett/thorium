import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { moduleReleaseKey } from "./core/release-key.js";
import { ServerModuleDescriptorSchema, type ServerModuleDescriptor } from "./module-descriptor.js";
import { assertModuleDirectory, moduleBytes, type ModuleEntry } from "./module-files.js";

export function modulePublicKey(pem: string): KeyObject {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("module signing key must be Ed25519");
  return key;
}

async function signedDescriptor(
  entry: ModuleEntry,
  key: KeyObject,
): Promise<ServerModuleDescriptor> {
  const bytes = await moduleBytes(join(entry.directory, "server-module.json"), 32 * 1024);
  const descriptor = ServerModuleDescriptorSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (moduleReleaseKey(descriptor.release) !== moduleReleaseKey(entry.release)) {
    throw new Error(`module_release_path_mismatch:${entry.directory}`);
  }
  const signatureBytes = await moduleBytes(join(entry.directory, "server-module.sig"), 2 * 1024);
  verifyDescriptorSignature(
    descriptor,
    signatureBytes.toString("utf8").trim(),
    key,
    entry.directory,
  );
  return descriptor;
}

function verifyDescriptorSignature(
  descriptor: ServerModuleDescriptor,
  text: string,
  key: KeyObject,
  directory: string,
): void {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text))
    throw new Error(`invalid_module_signature_encoding:${directory}`);
  const signature = Buffer.from(text, "base64");
  const valid =
    signature.length === 64 && verify(null, Buffer.from(canonicalJson(descriptor)), key, signature);
  if (!valid) throw new Error(`invalid_module_signature:${directory}`);
}

export async function verifiedModuleDescriptor(
  entry: ModuleEntry,
  key: KeyObject,
): Promise<ServerModuleDescriptor> {
  await assertModuleDirectory(entry.directory);
  const descriptor = await signedDescriptor(entry, key);
  const bytes = await moduleBytes(join(entry.directory, descriptor.entrypoint), 16 * 1024 * 1024);
  if (bytes.length !== descriptor.entrypointSizeBytes)
    throw new Error(`module_entrypoint_size_mismatch:${entry.directory}`);
  if (sha256(bytes) !== descriptor.entrypointSha256)
    throw new Error(`module_entrypoint_digest_mismatch:${entry.directory}`);
  return descriptor;
}
