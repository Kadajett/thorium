#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openSync, writeFileSync, closeSync } from 'node:fs';
import { parsePresentHistory, assessSurfacePresentation, parseCpuPresent, parseCurrentWebViewPackage } from './frame-present.mjs';

const args = process.argv.slice(2);
const flagStart = args.findIndex(arg => arg.startsWith('--'));
const positional = flagStart < 0 ? args : args.slice(0,flagStart);
assert.ok(positional.length >= 4 && positional.length <= 6,'Expected serial package version digest [60|120] [durationMs]');
const [serial,packageId,version,digest,fpsInput='60',durationInput='30000'] = positional;
let outputPath, staticSurface;
for (let i = flagStart < 0 ? args.length : flagStart; i < args.length; i += 2) {
  const flag = args[i], value = args[i+1];
  assert.ok(value && !value.startsWith('--'),'Every option requires a value');
  if (flag === '--output' && outputPath === undefined) outputPath = value;
  else if (flag === '--static-surface' && staticSurface === undefined && value === 'companion') staticSurface = value;
  else throw new Error('Unsupported or repeated option (supported: --output PATH, --static-surface companion)');
}
assert.match(serial ?? '', /^[A-Za-z0-9_.:-]+$/, 'An explicit ADB serial is required');
assert.match(packageId ?? '', /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
assert.match(digest ?? '', /^[a-f0-9]{64}$/);
const targetFps = Number(fpsInput), durationMs = Number(durationInput);
assert.ok([60,120].includes(targetFps));
assert.ok(Number.isInteger(durationMs) && durationMs >= 5000 && durationMs <= 120000);
const app = 'dev.yougotserved.thorium.debug';
const adb = process.env.ADB ?? join(homedir(),'Android/Sdk/platform-tools/adb');
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
function command(args) {
  const result = spawnSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024});
  if (result.status !== 0) throw new Error('ADB measurement failed');
  return result.stdout.trim();
}
const shell = args => command(['shell',args.map(quote).join(' ')]);
// Reserve before touching the device; wx refuses existing files and symlinks.
const outputFd = outputPath === undefined ? undefined : openSync(outputPath,'wx',0o600);
const json = value => JSON.stringify(value,(_key,item) => typeof item === 'bigint' ? String(item) : item);
const evidence = {schema:2,publishApproved:false,clock:'Android CLOCK_MONOTONIC via CDP Performance.Timestamp',
  windowConvention:'[start,end)',policy:'strict requested FPS, both whole-window and unrounded inter-present rates; no nominal-vsync tolerance',
  invocation:{serial,packageId,version,digest,targetFps,durationMs,staticSurface:staticSurface ?? null},samples:[]};
let localPort, socket;
try {
  const pid = shell(['pidof',app]); assert.match(pid,/^\d+$/);
  localPort = command(['forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`]);
  assert.match(localPort,/^\d+$/);
  let mainDebuggerPath;
  const inspect = async () => {
    const response = await fetch(`http://127.0.0.1:${localPort}/json/list`,{signal:AbortSignal.timeout(5000)});
    assert.equal(response.ok,true);
    const pages = await response.json();
    assert.equal(pages.length,2,'Exactly two candidate surfaces must be open');
    return ['main','companion'].map(role => {
      const prefix = `https://appassets.androidplatform.net/installed-games/releases/${packageId}/${version}/${digest}/${role}/`;
      const page = pages.find(page => typeof page.url === 'string' && page.url.startsWith(prefix));
      assert.ok(page,`Exact ${role} release not loaded`);
      const pageUrl = new URL(page.url);
      assert.ok(!pageUrl.search && !pageUrl.hash,'Surface URL must not contain query or fragment data');
      const description = JSON.parse(page.description);
      assert.equal(description.visible,true);
      assert.equal(description.attached,true);
      if (role === 'main') {
        mainDebuggerPath = new URL(page.webSocketDebuggerUrl).pathname;
        assert.match(mainDebuggerPath,/^\/devtools\/page\/[A-Za-z0-9_-]+$/);
      }
      return {role,targetId:page.id,releasePath:pageUrl.pathname,width:description.width,height:description.height};
    });
  };
  const surfaces = await inspect();
  socket = new WebSocket(`ws://127.0.0.1:${localPort}${mainDebuggerPath}`);
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timeout')),5000);
    socket.addEventListener('open',() => { clearTimeout(timer); resolve(); },{once:true});
    socket.addEventListener('error',() => { clearTimeout(timer); reject(new Error('CDP connection failed')); },{once:true});
  });
  let nextId = 0;
  const cdp = (method,params={}) => new Promise((resolve,reject) => {
    const id = ++nextId;
    const finish = (error,value) => {
      clearTimeout(timer); socket.removeEventListener('message',onMessage);
      if (error) reject(error); else resolve(value);
    };
    const onMessage = event => {
      const message = JSON.parse(event.data);
      if (message.id === id) finish(message.error ? new Error('CDP measurement command failed') : null,message.result);
    };
    const timer = setTimeout(() => finish(new Error('CDP measurement command timeout')),5000);
    socket.addEventListener('message',onMessage);
    socket.send(JSON.stringify({id,method,params}));
  });
  await cdp('Performance.enable',{timeDomain:'timeTicks'});
  // Chromium InspectorPerformanceAgent uses TimeTicks::Now().since_origin(); Android
  // TimeTicks uses CLOCK_MONOTONIC, the present-fence clock. Never use host time or uptime.
  const deviceNow = async () => {
    const {metrics} = await cdp('Performance.getMetrics');
    const seconds = metrics.find(metric => metric.name === 'Timestamp')?.value;
    assert.ok(Number.isFinite(seconds) && seconds > 0 && Number.isSafeInteger(Math.round(seconds*1e9)),'Invalid device monotonic timestamp');
    return BigInt(Math.round(seconds*1e9));
  };
  const layerOutput = shell(['dumpsys','SurfaceFlinger','--list']);
  const names = layerOutput.split(/\r?\n/).map(line => line.replace(/^RequestedLayerState\{/, '').split(' parentId=')[0]);
  const samples = surfaces.map(surface => {
    const activity = surface.role === 'main' ? 'MainGameActivity' : 'CompanionGameActivity';
    const prefix = `${app}/dev.yougotserved.thorium.${activity}#`;
    const candidates = names.filter(name => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)));
    assert.equal(candidates.length,1,`Ambiguous ${surface.role} presentation layer`);
    const layer = candidates[0];
    return {...surface,layer,snapshots:[]};
  });
  const apkPath = shell(['pm','path',app]).split(/\r?\n/).find(line => line.endsWith('/base.apk'))?.replace(/^package:/,'');
  assert.ok(apkPath && apkPath.startsWith('/data/app/'));
  const apkSha256 = shell(['sha256sum',apkPath]).split(/\s+/)[0];
  assert.match(apkSha256,/^[a-f0-9]{64}$/);
  const cpu = parseCpuPresent(shell(['cat','/sys/devices/system/cpu/present']));
  const graphicsProperties = Object.fromEntries([
    'ro.hardware','ro.hardware.egl','ro.hardware.vulkan','ro.opengles.version','debug.hwui.renderer','ro.boot.qemu.gltransport'
  ].map(property => {
    const value = shell(['getprop',property]);
    assert.match(value,/^[A-Za-z0-9._:+/ -]{0,128}$/,'Invalid graphics configuration property');
    return [property,value || null];
  }));
  // Filter on-device: no full dumpsys output or unrelated package details enter evidence.
  const webView = parseCurrentWebViewPackage(shell(['sh','-c',"dumpsys webviewupdate | sed -n '/^[[:space:]]*Current WebView package (name, version):/p'"]));
  const metadata = {serial,emulator:shell(['getprop','ro.kernel.qemu']) === '1',model:shell(['getprop','ro.product.model']),
    api:shell(['getprop','ro.build.version.sdk']),cpu,graphicsProperties,webView,
    graphicsPropertiesMeaning:'Reported configuration only; not proof of the active GPU/rendering path',
    applicationId:app,apkSha256,packageId,version,digest,targetFps,durationMs};
  evidence.metadata = metadata;
  evidence.samples = samples;
  console.log(JSON.stringify({status:'measuring_presented_frames',...metadata}));
  const collect = async sample => {
    const collectedAfterNs = await deviceNow();
    const raw = shell(['dumpsys','SurfaceFlinger','--latency',sample.layer]);
    const collectedAtNs = await deviceNow();
    assert.ok(collectedAtNs >= collectedAfterNs,'Device clock moved backwards');
    sample.snapshots.push({collectedAfterNs,collectedAtNs,raw,history:parsePresentHistory(raw)});
    return collectedAtNs;
  };
  // Hashing, device metadata and baseline collection must precede the shared window.
  for (const sample of samples) await collect(sample);
  const windowStartNs = await deviceNow();
  const windowEndNs = windowStartNs + BigInt(durationMs)*1_000_000n;
  evidence.window = {windowStartNs,windowEndNs};
  const watchdogStart = performance.now();
  let deviceTime = windowStartNs;
  while (deviceTime < windowEndNs + 3_000_000_000n) {
    assert.ok(performance.now()-watchdogStart < durationMs+20000,'Device-clock observation watchdog expired');
    for (const sample of samples) {
      deviceTime = await collect(sample);
    }
    await new Promise(resolve => setTimeout(resolve,200));
  }
  assert.deepEqual(await inspect(),surfaces,'Candidate placement changed during measurement');
  const results = samples.map(sample => ({role:sample.role,layer:sample.layer,width:sample.width,height:sample.height,
    refreshPeriodNs:String(sample.snapshots[0].history.refreshPeriodNs),
    ...assessSurfacePresentation(sample.snapshots,{targetFps,minimumDurationMs:durationMs,windowStartNs,windowEndNs,
      mode:sample.role === staticSurface ? 'static-advisory' : 'active'})}));
  const pass = results.every(result => result.coverage.pass && (result.mode === 'static-advisory' || result.pass));
  evidence.report = {status:!pass?'present_rate_failed':staticSurface?'active_present_rate_passed_static_surface_unassessed':'present_rate_passed',
    ...metadata,window:evidence.window,results,publishApproved:false,
    note:'Presentation-rate subgate only. Static advisory does not establish render capacity or input-to-paint latency. Representative gameplay, functional/input/privacy checks, physical-device evidence and release approval remain required. Nominal-vsync tolerance is not authorized.'};
  console.log(json(evidence.report));
  if (!pass) process.exitCode = 1;
} catch (error) {
  evidence.failure = {name:error.name,message:error.message};
  console.error(json({status:'measurement_failed',publishApproved:false,...evidence.failure}));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (localPort) {
    try { command(['forward','--remove',`tcp:${localPort}`]); }
    catch { evidence.cleanupFailure = 'Could not remove the measurement ADB forward'; process.exitCode = 1; }
  }
  if (outputFd !== undefined) {
    try { writeFileSync(outputFd,json(evidence)+'\n'); } finally { closeSync(outputFd); }
  }
}
