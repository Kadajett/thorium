#!/usr/bin/env node
// Private candidate launch in an explicitly selected rooted emulator. No catalog writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyPublishedGameRelease } from '../../../services/platform/dist/publication/verify-game-release.js';

const [serial, descriptorPath, archivePath, mode] = process.argv.slice(2);
assert.match(serial ?? '', /^emulator-\d+$/, 'Explicit emulator serial required; this tool must not root a physical device');
assert.ok(descriptorPath && archivePath && mode === '--local-practice', 'Usage: stage-local-game.mjs emulator-N descriptor.json game.zip --local-practice');
const adb = process.env.ADB ?? join(homedir(), 'Android/Sdk/platform-tools/adb');
const applicationId = 'dev.yougotserved.thorium.debug';
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
function command(args) {
  const result = spawnSync(adb, ['-s', serial, ...args], {encoding:'utf8', timeout:30000, maxBuffer:1024*1024});
  if (result.status !== 0) throw new Error(`ADB command failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const shell = args => command(['shell', args.map(quote).join(' ')]);
assert.equal(shell(['id', '-u']), '0', 'Run adb root on this emulator explicitly first');
assert.equal(shell(['getprop', 'ro.kernel.qemu']), '1', 'Only an emulator is permitted');

// Use exactly the production archive verifier before any device write.
const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
const archive = await readFile(archivePath);
const { release } = verifyPublishedGameRelease({descriptor, archive:{fileName:basename(archivePath),bytes:archive}, publicBaseUrl:'https://games.yougotserved.dev', publishedAt:new Date().toISOString()});
const plan = release.players.defaultLocalSeatPlan;
assert.ok(plan, 'Candidate must declare its PlayerSlot seat plan');
assert.ok(['0.1.0','^0.1.0','0.1.1','^0.1.1'].includes(release.runtime.sdkCompatibility), 'Candidate must work with the public dev.9 runtime');
const session = randomUUID();
const remoteZip = `/data/local/tmp/thorium-candidate-${session}.zip`;
const target = `files/game-packages/releases/${release.packageId}/${release.version}/${release.contentDigest}`;
const absoluteTarget = `/data/user/0/${applicationId}/${target}`;
const exists = shell(['sh','-c',`if test -d ${quote(absoluteTarget)}; then echo yes; else echo no; fi`]) === 'yes';
if (!exists) {
  command(['push', archivePath, remoteZip]);
  shell(['chmod','644',remoteZip]);
  const temporaryTarget = `${target}.stage-${session}`;
  shell(['run-as',applicationId,'mkdir','-p',temporaryTarget]);
  shell(['run-as',applicationId,'unzip','-q',remoteZip,'-d',temporaryTarget]);
  shell(['run-as',applicationId,'mv',temporaryTarget,target]);
}
// Check actual installed bytes even when reusing an existing immutable directory.
const expected = [{path:'thorium.json',sha256:descriptor.manifestSha256}, ...descriptor.execution.files];
for (const file of expected) {
  const actual = shell(['run-as',applicationId,'sha256sum',`${target}/${file.path}`]).split(/\s+/)[0];
  assert.equal(actual, file.sha256, `Candidate hash mismatch: ${file.path}`);
}

const intent = ['am','start','--display','0','-n',`${applicationId}/dev.yougotserved.thorium.MainGameActivity`];
const extra = (type,key,value) => intent.push(type,key,String(value));
const strings = (key,values) => { if (values.length) extra('--esa',key,values.map(value => value.replaceAll(',', '\\,')).join(',')); };
const integers = (key,values) => { if (values.length) extra('--eia',key,values.join(',')); };
extra('--es','package_id',release.packageId);
extra('--es','game_version',release.version);
extra('--es','session_id',session);
extra('--es','content_digest',release.contentDigest);
extra('--es','main_entrypoint',release.runtime.entrypoints.main.path);
extra('--es','companion_entrypoint',release.runtime.entrypoints.companion.path);
strings('runtime_files',release.runtime.files);
strings('control_ids',release.controls.map(control => control.id));
strings('control_labels',release.controls.map(control => control.label));
strings('control_kinds',release.controls.map(control => control.kind));
if (release.controllerBindings) extra('--es','controller_bindings',JSON.stringify(release.controllerBindings));
for (const [role,prefix] of [['main',''],['companion','companion_']]) {
  const screen = release.displays[role];
  extra('--ei',`${prefix}logical_width`,screen.logicalWidth);
  extra('--ei',`${prefix}logical_height`,screen.logicalHeight);
  extra('--ed',`${prefix}maximum_device_pixel_ratio`,screen.maximumDevicePixelRatio);
  integers(`${role}_controlled_player_slots`,plan[role]);
}
integers('local_player_slots',[...plan.main,...plan.companion]);
extra('--ei','max_local_slots',release.players.maxLocalSlots);
extra('--ei','max_local_peer_message_bytes',release.budgets.maxLocalPeerMessageBytes);
strings('capabilities',release.capabilities.filter(capability => capability !== 'colyseus-session'));
shell(intent);
console.log(JSON.stringify({status:'candidate-launch-requested',serial,applicationId,packageId:release.packageId,version:release.version,contentDigest:release.contentDigest,mode:'local-practice',published:false,onlineAdmissionTested:false,performancePassed:false}));
