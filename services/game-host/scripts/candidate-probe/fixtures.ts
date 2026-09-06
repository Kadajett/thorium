import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256 } from "../../src/canonical-json.js";
import { ServerModuleDescriptorSchema } from "../../src/module-descriptor.js";

export async function readCandidate(directory: string) {
  const descriptorBytes = await readFile(join(directory, "server-module.json"));
  const input: unknown = JSON.parse(descriptorBytes.toString("utf8"));
  const descriptor = ServerModuleDescriptorSchema.parse(input);
  const bytes = await readFile(join(directory, descriptor.entrypoint));
  if (
    bytes.length !== descriptor.entrypointSizeBytes ||
    sha256(bytes) !== descriptor.entrypointSha256
  ) {
    throw new Error(`Candidate entrypoint does not match its descriptor: ${directory}`);
  }
  return { directory, descriptor, descriptorBytes, bytes };
}

export type ProbeCandidate = Awaited<ReturnType<typeof readCandidate>>;

async function copyCandidate(
  root: string,
  candidate: ProbeCandidate,
  key: KeyObject,
): Promise<void> {
  const { descriptor, descriptorBytes, bytes } = candidate;
  const { packageId, version, contentDigest } = descriptor.release;
  const directory = join(root, "modules", packageId, version, contentDigest);
  await mkdir(directory, { recursive: true });
  const signature = sign(null, Buffer.from(canonicalJson(descriptor)), key).toString("base64");
  await Promise.all([
    writeFile(join(directory, "server-module.json"), descriptorBytes, { flag: "wx" }),
    writeFile(join(directory, descriptor.entrypoint), bytes, { flag: "wx" }),
    writeFile(join(directory, "server-module.sig"), signature, { flag: "wx" }),
  ]);
}

async function fixtureDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "thorium-shared-candidate-probe-"));
  const dependencies = resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules");
  await symlink(dependencies, join(root, "node_modules"));
  return root;
}

export async function candidateFixture(candidates: readonly ProbeCandidate[]) {
  const root = await fixtureDirectory();
  const keys = generateKeyPairSync("ed25519");
  for (const candidate of candidates) await copyCandidate(root, candidate, keys.privateKey);
  return { root, publicKeyPem: publicKeyPem(keys.publicKey) };
}

function publicKeyPem(key: KeyObject): string {
  return key.export({ format: "pem", type: "spki" }).toString();
}

export async function verifyUnchanged(candidates: readonly ProbeCandidate[]): Promise<void> {
  for (const before of candidates) await verifyCandidateUnchanged(before);
}

async function verifyCandidateUnchanged(before: ProbeCandidate): Promise<void> {
  const after = await readCandidate(before.directory);
  const entrypointUnchanged = before.bytes.equals(after.bytes);
  const descriptorUnchanged = before.descriptorBytes.equals(after.descriptorBytes);
  if (!entrypointUnchanged || !descriptorUnchanged) {
    throw new Error(`Source candidate changed during the probe: ${before.directory}`);
  }
}
