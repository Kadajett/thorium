import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { canonicalJson, sha256 } from "./descriptor.js";
import { validateManifest } from "./manifest.js";
import { loadGamePackage, packGamePackage } from "./pack.js";
import { validManifest } from "./test-fixtures.js";
import { packageFixture } from "./file-fixtures.js";
const files = [
  { path: "main/index.html", bytes: new TextEncoder().encode("main") },
  { path: "companion/index.html", bytes: new TextEncoder().encode("companion") },
  { path: "game.js", bytes: new TextEncoder().encode("export {}") },
];
await test("packs byte-for-byte deterministic ZIPs and a stable sorted descriptor", () => {
  const manifest = validateManifest(validManifest);
  const first = packGamePackage({ manifest, files }, "test-game.zip");
  const second = packGamePackage({ manifest, files: [...files].reverse() }, "test-game.zip");
  assert.deepEqual(first.archive, second.archive);
  assert.equal(canonicalJson(first.descriptor), canonicalJson(second.descriptor));
  assert.deepEqual(
    first.descriptor.execution.files.map((file) => file.path),
    ["companion/index.html", "game.js", "main/index.html"],
  );
  assert.deepEqual(Object.keys(unzipSync(first.archive)).sort(), [
    "companion/index.html",
    "game.js",
    "main/index.html",
    "thorium.json",
  ]);
  assert.equal(first.descriptor.bundle.sha256, sha256(first.archive));
  assert.equal(first.descriptor.bundle.sizeBytes, first.archive.byteLength);
});
await test("archive digest is tamper evidence for the immutable Game Package", () => {
  const packed = packGamePackage({ manifest: validateManifest(validManifest), files });
  const tampered = packed.archive.slice(),
    index = Math.floor(packed.archive.length / 2);
  const byte = tampered[index];
  assert.ok(byte !== undefined);
  tampered[index] = byte ^ 1;
  assert.notEqual(sha256(tampered), packed.descriptor.bundle.sha256);
});
await test("packing enforces real archive entry and byte budgets", () => {
  const tooFewEntries = validateManifest({
    ...validManifest,
    budgets: { ...validManifest.budgets, maxFileCount: 3 },
  });
  assert.throws(
    () => packGamePackage({ manifest: tooFewEntries, files }),
    /4 entries.*maxFileCount is 3/,
  );
  const tooFewBytes = validateManifest({
    ...validManifest,
    budgets: { ...validManifest.budgets, maxPackageBytes: 10 },
  });
  assert.throws(() => packGamePackage({ manifest: tooFewBytes, files }), /maxPackageBytes is 10/);
});
await test("filesystem loader rejects symlinks and non-regular declared entries", async () => {
  const fixture = await packageFixture(validManifest),
    target = path.join(fixture.root, "game.js");
  const outside = path.join(fixture.root, "outside.js");
  await writeFile(outside, "outside");
  await rm(target);
  await symlink(outside, target);
  await assert.rejects(loadGamePackage(fixture.manifestPath), /symlink/);
  await rm(target);
  await mkdir(target);
  await assert.rejects(loadGamePackage(fixture.manifestPath), /not a regular file/);
});
