import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "../../src/canonical-json.js";
import { createGameModuleLoader, type GameModuleLoaderPort } from "../../src/module-loader.js";
import { physicalRoomName } from "../../src/room-name.js";
import {
  candidateFixture,
  readCandidate,
  verifyUnchanged,
  type ProbeCandidate,
} from "./fixtures.js";
import { probeAdmission, probeRegistry } from "./ports.js";

function fixtureLoader(
  fixture: Awaited<ReturnType<typeof candidateFixture>>,
  registered: string[],
) {
  return createGameModuleLoader({
    moduleDirectory: join(fixture.root, "modules"),
    stateDirectory: join(fixture.root, "state"),
    endpoint: "http://127.0.0.1:1/probe-not-listening",
    moduleSigningPublicKeyPem: fixture.publicKeyPem,
    admission: { scoped: () => probeAdmission },
    registry: { scoped: () => probeRegistry },
    registerRoom: (name) => {
      registered.push(name);
    },
  });
}

async function verifyLoaded(loader: GameModuleLoaderPort, count: number): Promise<void> {
  assert.equal(await loader.scan(), count);
  assert.equal(await loader.scan(), 0);
  assert.equal(loader.loaded.length, count);
}

function verifyNames(candidates: readonly ProbeCandidate[], registered: readonly string[]): void {
  const expected = candidates.flatMap(({ descriptor }) =>
    descriptor.rooms.map((room) => physicalRoomName(descriptor.release, room.localName)),
  );
  assert.deepEqual([...registered].sort(), expected.sort());
  assert.equal(new Set(registered).size, registered.length);
}

async function loadTogether(
  candidates: readonly ProbeCandidate[],
  fixture: Awaited<ReturnType<typeof candidateFixture>>,
) {
  const registered: string[] = [];
  const loader = fixtureLoader(fixture, registered);
  try {
    await verifyLoaded(loader, candidates.length);
    verifyNames(candidates, registered);
  } finally {
    await loader.dispose();
  }
  assert.equal(loader.loaded.length, 0);
  return registered;
}

function candidateEvidence(candidate: ProbeCandidate) {
  return {
    directory: candidate.directory,
    release: candidate.descriptor.release,
    entrypointSha256: sha256(candidate.bytes),
    descriptorSha256: sha256(candidate.descriptorBytes),
  };
}

async function run(): Promise<void> {
  const directories = process.argv.slice(2).map((directory) => resolve(directory));
  assert.ok(directories.length >= 2, "Supply at least two trusted local candidate directories");
  const candidates = await Promise.all(directories.map(readCandidate));
  const fixture = await candidateFixture(candidates);
  const registrations = await loadTogether(candidates, fixture);
  await verifyUnchanged(candidates);
  const evidence = {
    scope:
      "Real immutable modules, production loader, fixture signing and load-only ports; no sockets, matchmaking or FPS verification",
    candidates: candidates.map(candidateEvidence),
    registrations,
    repeatedScanAdded: 0,
    disposedLoadedCount: 0,
    sourcesUnchanged: true,
  };
  const path = join(fixture.root, "evidence.json");
  await writeFile(path, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(`${path}\n`);
}

await run();
