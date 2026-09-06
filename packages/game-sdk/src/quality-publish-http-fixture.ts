import assert from "node:assert/strict";
import { canonicalJson, sha256 } from "./descriptor.js";
import { loadGamePackage, packGamePackage, type PackedGamePackage } from "./pack.js";
import type { PublicationReceipt } from "./publish.js";
import { PLATFORM_URL, TOKEN, validManifest } from "./quality-publish-package-fixture.js";

export interface ExpectedPublication {
  readonly packed: PackedGamePackage;
  readonly descriptor: string;
  readonly digest: string;
}
export async function expectedPublication(manifestPath: string): Promise<ExpectedPublication> {
  const packed = packGamePackage(await loadGamePackage(manifestPath));
  const descriptor = canonicalJson(packed.descriptor);
  return { packed, descriptor, digest: sha256(descriptor) };
}
export function receipt(contentDigest: string): PublicationReceipt {
  return {
    status: "published",
    release: { packageId: validManifest.packageId, version: validManifest.version, contentDigest },
  };
}
export function publicationResponse(status: 200 | 201, receipt: PublicationReceipt): Response {
  return Response.json(receipt, { status });
}
function assertHeaders(input: RequestInfo | URL, init: RequestInit | undefined): void {
  assert.equal(
    new URL(input instanceof Request ? input.url : input).toString(),
    `${PLATFORM_URL}/v1/publisher/releases`,
  );
  assert.ok(init !== undefined);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.ok(init.signal instanceof AbortSignal, "a publication timeout signal is required");
  assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${TOKEN}`);
  assert.ok(init.body instanceof FormData);
}
function assertArchive(archive: File, expected: ExpectedPublication): void {
  const bundle = expected.packed.descriptor.bundle;
  assert.equal(archive.name, bundle.fileName);
  assert.equal(archive.type, "application/zip");
  assert.equal(archive.size, bundle.sizeBytes);
}
function checkedFields(form: FormData): Readonly<{ descriptor: string; archive: File }> {
  assert.deepEqual([...form.keys()].sort(), ["archive", "descriptor"]);
  return {
    descriptor: descriptorField(form.get("descriptor")),
    archive: archiveField(form.get("archive")),
  };
}
function descriptorField(descriptor: FormDataEntryValue | null): string {
  assert.equal(typeof descriptor, "string");
  if (typeof descriptor !== "string")
    return assert.fail("multipart fields were not encoded as descriptor text and an archive file");
  return descriptor;
}
function archiveField(archive: FormDataEntryValue | null): File {
  assert.notEqual(typeof archive, "string");
  if (archive === null || typeof archive === "string")
    return assert.fail("multipart fields were not encoded as descriptor text and an archive file");
  return archive;
}
async function assertMultipart(form: FormData, expected: ExpectedPublication): Promise<string> {
  const { descriptor, archive } = checkedFields(form);
  assert.equal(descriptor, expected.descriptor);
  assertArchive(archive, expected);
  const digest = sha256(new Uint8Array(await archive.arrayBuffer()));
  assert.equal(digest, expected.packed.descriptor.bundle.sha256);
  return digest;
}
export function publicationMock(expected: ExpectedPublication) {
  const archiveDigests: string[] = [];
  let requests = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests += 1;
    assertHeaders(input, init);
    archiveDigests.push(await assertMultipart(await new Request(input, init).formData(), expected));
    return retryReceipt(expected.digest, requests);
  };
  return { fetch, archiveDigests };
}
function retryReceipt(digest: string, requests: number): Response {
  return requests === 1
    ? publicationResponse(201, receipt(digest))
    : publicationResponse(200, { ...receipt(digest), status: "already-published" });
}
export function invalidReceipts(digest: string): readonly (() => Response)[] {
  const correct = receipt(digest),
    release = correct.release;
  return [
    () => new Response("not json", { status: 201 }),
    () => publicationResponse(201, { ...correct, status: "already-published" }),
    () =>
      publicationResponse(201, {
        ...correct,
        release: { ...release, packageId: "dev.example.other" },
      }),
    () => publicationResponse(201, { ...correct, release: { ...release, version: "9.9.9" } }),
    () =>
      publicationResponse(201, {
        ...correct,
        release: { ...release, contentDigest: "f".repeat(64) },
      }),
  ];
}
export function safeError(error: unknown, expected: RegExp, echo: string): true {
  const message = String(error);
  assert.match(message, expected);
  assert.equal(message.includes(TOKEN), false);
  assert.equal(message.includes(echo), false);
  assert.equal(message.includes("descriptor-and-archive-echo"), false);
  return true;
}
