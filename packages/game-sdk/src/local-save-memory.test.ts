import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryLocalSaveStore } from "./local-save-memory.js";
import { localSaveLimits } from "./core/local-save-value.js";
await test("package saves survive reopening, isolate packages, and copy caller values", async () => {
  const store = createMemoryLocalSaveStore(),
    a = store.open("dev.a"),
    b = store.open("dev.b");
  const value = { score: 7, cards: ["one"] };
  const revision = await a.write("expedition.v1", value, null);
  value.cards.push("changed");
  assert.deepEqual(await store.open("dev.a").read("expedition.v1"), {
    revision,
    value: { score: 7, cards: ["one"] },
  });
  assert.equal(await b.read("expedition.v1"), null);
  assert.equal(await a.read("constructor"), null);
});
await test("simultaneous surfaces use atomic revision checks", async () => {
  const store = createMemoryLocalSaveStore(),
    a = store.open("dev.a"),
    b = store.open("dev.a");
  const revision = await a.write("run", { level: 1 }, null);
  const results = await Promise.allSettled([
    a.write("run", 2, revision),
    b.write("run", 3, revision),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
});
await test("delete/recreate never reuses a revision", async () => {
  const store = createMemoryLocalSaveStore(),
    a = store.open("dev.a"),
    b = store.open("dev.a");
  const revision = await a.write("run", { level: 1 }, null);
  const current = await a.read("run");
  assert.ok(current !== null);
  await b.remove("run", current.revision);
  const recreated = await a.write("run", 4, null);
  assert.ok(recreated > current.revision);
  await assert.rejects(b.write("run", 5, revision), { code: "conflict" });
});
await test("UTF-8 value quota rejects before mutation and exact limits are accepted", async () => {
  const save = createMemoryLocalSaveStore().open("dev.a");
  const exact = "x".repeat(localSaveLimits.maxValueBytes - 2);
  assert.equal(await save.write("run", exact, null), 1);
  await assert.rejects(save.write("run", "é".repeat(65536), 1), { code: "quota_exceeded" });
  assert.equal((await save.read("run"))?.revision, 1);
});
await test("aggregate quota failures preserve revisions", async () => {
  const save = createMemoryLocalSaveStore().open("dev.a"),
    value = "x".repeat(131070);
  for (const key of ["one", "two", "three", "four"]) await save.write(key, value, null);
  await assert.rejects(save.write("five", 0, null), { code: "quota_exceeded" });
  await save.remove("one", 1);
  assert.equal(await save.write("five", 0, null), 6);
});
await test("package key quota rejects additional keys", async () => {
  const small = createMemoryLocalSaveStore().open("dev.small");
  for (let i = 0; i < 16; i++) await small.write(`slot.${String(i)}`, null, null);
  await assert.rejects(small.write("seventeen", 1, null), { code: "quota_exceeded" });
});
await test("save keys cannot select paths and invalid JSON values cannot silently serialize", async () => {
  const save = createMemoryLocalSaveStore().open("dev.a");
  await assert.rejects(save.read("../other"), { code: "invalid_request" });
  await assert.rejects(save.write("run", Number.NaN, null), { code: "invalid_request" });
  await assert.rejects(save.write("run", { bad: Number.POSITIVE_INFINITY }, null), {
    code: "invalid_request",
  });
  await assert.rejects(save.remove("run", 0), { code: "invalid_request" });
});
