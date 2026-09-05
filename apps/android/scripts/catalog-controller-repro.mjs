import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Real ViewRoot -> Activity -> Compose regression. Requires an already installed APK
// and a catalog containing Cinder + Serpent. Restarts the app; does not install/clear data.
// Run: node apps/android/scripts/catalog-controller-repro.mjs [--joystick]
// Override ADB, ANDROID_SERIAL, or THORIUM_APP_ID to select an explicit test target.
const sdkAdb = join(process.env.ANDROID_HOME ?? join(homedir(), "Android", "Sdk"), "platform-tools", "adb");
const adb = process.env.ADB ?? (existsSync(sdkAdb) ? sdkAdb : "adb");
const serial = process.env.ANDROID_SERIAL ?? "emulator-5554";
const app = process.env.THORIUM_APP_ID ?? "dev.yougotserved.thorium.debug";
const joystick = process.argv.includes("--joystick");
const output = mkdtempSync(join(tmpdir(), "thorium-catalog-controller-"));
const run = (...args) => {
  const result = spawnSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr || result.error || result.stdout}`);
  return result.stdout;
};
const shell = (...args) => run("shell", ...args);
const decode = value => value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");
function nodes(xml) {
  const stack = [], all = [];
  for (const token of xml.match(/<node\b[^>]*>|<\/node>/g) ?? []) {
    if (token === "</node>") { stack.pop(); continue; }
    const attrs = Object.fromEntries([...token.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
    const node = { ...attrs, children: [] };
    stack.at(-1)?.children.push(node);
    all.push(node);
    if (!token.endsWith("/>")) stack.push(node);
  }
  return all;
}
const text = node => [node.text, node["content-desc"], ...node.children.map(text)].join(" ");
const card = (all, title) => all.find(node => node.checkable === "true" && text(node).includes(title));
const bounds = node => [...node.bounds.matchAll(/\d+/g)].map(match => Number(match[0]));
function snapshot(name) {
  shell("uiautomator", "dump", "/sdcard/thorium-controller-repro.xml");
  const xml = shell("cat", "/sdcard/thorium-controller-repro.xml");
  writeFileSync(join(output, `${name}.xml`), xml);
  return nodes(xml);
}
function summary(all) {
  return all.filter(node => node.checkable === "true" || node.focused === "true")
    .map(node => ({ text: text(node).trim().slice(0, 65), checked: node.checked, focused: node.focused, bounds: node.bounds }));
}
function openCatalog() {
  shell("am", "force-stop", app);
  shell("am", "start", "-W", "-n", `${app}/dev.yougotserved.thorium.MainActivity`);
  for (let attempt = 0; attempt < 8; attempt++) {
    const all = snapshot(`loading-${attempt}`);
    if (card(all, "Cinder Circuit") && card(all, "Serpent World")) return all;
  }
  throw new Error("Catalog did not expose both required game cards");
}

console.log(`Evidence: ${output}`);
let initial = openCatalog();
const heading = initial.find(node => node.text === "THORIUM  /  GAME LIBRARY");
assert.ok(heading, "Launcher heading is present");
const [x1, y1, x2, y2] = bounds(heading);
shell("input", "-d", "0", "tap", String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)));
// Touch mode is window-system state: recreate after a touch so first focus request
// sees the same state as a touch-driven cold launch on the handheld.
initial = openCatalog();
writeFileSync(join(output, "before.json"), JSON.stringify(summary(initial), null, 2));
const cinder = card(initial, "Cinder Circuit"), serpent = card(initial, "Serpent World");
assert.equal(cinder.checked, "true", "Initial explicit selection is Cinder");
const expectedTitle = bounds(serpent)[1] > bounds(cinder)[3] ? "Serpent World" : "Cinder Circuit";
if (joystick) shell("input", "joystick", "-d", "0", "motionevent", "MOVE", "0", "1");
else shell("input", "-d", "0", "keyevent", "KEYCODE_DPAD_DOWN");
const after = snapshot(joystick ? "after-first-stick" : "after-first-down");
const traces = run("logcat", "-d", "-t", "300", "-s", "ThoriumInput:I", "*:S");
writeFileSync(join(output, "input.log"), traces);
console.log(JSON.stringify({ before: summary(initial), after: summary(after), expectedTitle }, null, 2));
assert.equal(card(after, expectedTitle)?.checked, "true", `First Down selects ${expectedTitle}`);
assert.equal(card(after, expectedTitle)?.focused, "true", `First Down focuses ${expectedTitle}`);
assert.ok(!after.some(node => node.focused === "true" && text(node).includes("Search")), "First Down must not focus Search");
console.log(`PASS: first real ${joystick ? "joystick" : "D-pad"} event preserves explicit catalog navigation`);
