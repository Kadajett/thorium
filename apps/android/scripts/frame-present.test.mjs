import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePresentHistory, assessPresentRate, assessHistoryCoverage, assessSurfacePresentation, parseCpuPresent, parseCurrentWebViewPackage } from './frame-present.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const options = {targetFps:60,minimumDurationMs:1000,windowStartNs:0n,windowEndNs:2_000_000_000n};

test('CPU topology records actual present logical CPUs including sparse ranges', () => {
  assert.deepEqual(parseCpuPresent('0-1\n'),{present:'0-1',logicalCount:2});
  assert.deepEqual(parseCpuPresent('0-3'),{present:'0-3',logicalCount:4});
  assert.deepEqual(parseCpuPresent('0,2,4-7'),{present:'0,2,4-7',logicalCount:6});
  for (const input of ['', '4-2', '0-3,2-4', '0,0', '-1', '0-999999999999999999999', 'host CPU: 4']) {
    assert.throws(() => parseCpuPresent(input),/Invalid present-CPU/);
  }
});

test('WebView metadata accepts only the active package/version line, not an unfiltered dump', () => {
  const line = '  Current WebView package (name, version): (com.google.android.webview, 138.0.7204.179)\n';
  assert.deepEqual(parseCurrentWebViewPackage(line),{packageName:'com.google.android.webview',versionName:'138.0.7204.179'});
  for (const input of ['Current WebView package is null', 'Preferred WebView package (name, version): (com.android.webview, 138.0.0.0)',line+'unrelated private data',line+line]) {
    assert.throws(() => parseCurrentWebViewPackage(input),/unavailable or invalid/);
  }
});

test('actual present column excludes zero and pending fences, deduplicates history', () => {
  const result = parsePresentHistory('16666666\n1 30 29\n2 20 19\n1 30 29\n0 0 0\n4 9223372036854775807 9');
  assert.deepEqual(result.timestamps,[20n,30n]);
  assert.equal(result.refreshPeriodNs,16666666n);
  assert.throws(() => parsePresentHistory('garbage'));
  assert.throws(() => parsePresentHistory('16666666\n1 wrong 3'));
});

test('60 Hz display metadata does not make a 30 FPS game pass', () => {
  const frames = Array.from({length:61}, (_,i) => BigInt(i)*33_333_334n);
  assert.equal(assessPresentRate(frames,options).pass,false);
  const fortyFive = Array.from({length:100},(_,i) => BigInt(i)*22_222_223n);
  assert.equal(assessPresentRate(fortyFive,options).pass,false);
});

test('strict unrounded rates reject 59.99; adequate 60 and 120 streams pass', () => {
  const sixty = Array.from({length:122}, (_,i) => BigInt(i)*16_666_666n);
  const nearSixty = Array.from({length:122}, (_,i) => BigInt(i)*16_669_445n);
  const oneTwenty = Array.from({length:242}, (_,i) => BigInt(i)*8_333_333n);
  assert.equal(assessPresentRate(sixty,options).pass,true);
  const nearResult = assessPresentRate(nearSixty,options);
  assert.equal(nearResult.fps,60,'Whole-window integer frame counts must not hide fractional slow cadence');
  assert.ok(nearResult.intervalFps < 60);
  assert.equal(nearResult.pass,false);
  assert.equal(assessPresentRate(sixty,{...options,targetFps:120}).pass,false);
  assert.equal(assessPresentRate(oneTwenty,{...options,targetFps:120}).pass,true);
});

test('static and too-short observations fail closed; long stalls are included', () => {
  assert.equal(assessPresentRate([],options).pass,false);
  assert.equal(assessPresentRate([1n,2n],options).pass,false);
  assert.equal(assessPresentRate([1n,2n],{...options,windowEndNs:500_000_000n}).reason,'insufficient_measurement_duration');
  const frames = Array.from({length:121}, (_,i) => BigInt(i)*16_666_666n);
  frames.push(5_000_000_000n);
  const result = assessPresentRate(frames,{...options,windowEndNs:6_000_000_000n});
  assert.equal(result.pass,false);
  assert.ok(result.maxFrameMs > 3000);
});

test('timestamps outside the common window do not inflate either surface; endpoints are half-open', () => {
  const bounds = {...options,windowStartNs:1_000_000_000n,windowEndNs:3_000_000_000n};
  const main = assessPresentRate([0n,999_999_999n,1_000_000_000n,2_000_000_000n,3_000_000_000n,4_000_000_000n],bounds);
  const companion = assessPresentRate([1_500_000_000n,2_500_000_000n],bounds);
  assert.equal(main.frames,2);
  assert.equal(main.fps,1);
  assert.equal(main.durationMs,companion.durationMs);
  assert.equal(main.leadingIdleMs,0);
  assert.equal(main.trailingIdleMs,1000);
  assert.equal(companion.leadingIdleMs,500);
});

test('invalid or missing clocks and unauthorized targets fail closed', () => {
  assert.throws(() => assessPresentRate([],{targetFps:60,minimumDurationMs:1000}),/explicit/);
  assert.throws(() => assessPresentRate([],{...options,windowEndNs:0n}),/explicit/);
  assert.throws(() => assessPresentRate([NaN],options),/timestamp/);
  assert.throws(() => assessPresentRate([],{...options,targetFps:59.9}),/60 or 120/);
});

const snapshot = (collectedAtNs,times,extraRows=[]) => ({collectedAfterNs:collectedAtNs,collectedAtNs,
  history:parsePresentHistory(['16666666',...times.map(time => `${time} ${time} ${time}`),...extraRows,'0 0 0'].join('\n'))});
const coverageWindow = {windowStartNs:100n,windowEndNs:1000n};

test('overlapping snapshots cover a shared device window; repeated static buffers are valid coverage', () => {
  const snapshots = [snapshot(90n,[10n,20n]),snapshot(500n,[20n,300n]),snapshot(1100n,[300n,900n])];
  assert.equal(assessHistoryCoverage(snapshots,coverageWindow).pass,true);
  assert.equal(assessHistoryCoverage([snapshot(90n,[10n]),snapshot(1100n,[10n])],coverageWindow).pass,true);
  assert.equal(assessHistoryCoverage([snapshot(90n,[]),snapshot(1100n,[])],coverageWindow).pass,true);
});

test('ring overflow, reset, late start and premature end are coverage failures, not FPS findings', () => {
  assert.equal(assessHistoryCoverage([snapshot(90n,[10n]),snapshot(1100n,[500n])],coverageWindow).reason,'frame_history_coverage_gap');
  assert.equal(assessHistoryCoverage([snapshot(90n,[10n]),snapshot(1100n,[])],coverageWindow).pass,false);
  assert.equal(assessHistoryCoverage([snapshot(110n,[10n]),snapshot(1100n,[10n])],coverageWindow).reason,'observation_window_not_covered');
  assert.equal(assessHistoryCoverage([snapshot(90n,[10n]),snapshot(900n,[10n])],coverageWindow).pass,false);
  const full = {collectedAfterNs:1100n,collectedAtNs:1100n,history:parsePresentHistory('16666666\n10 10 10\n500 500 500')};
  assert.equal(assessHistoryCoverage([snapshot(90n,[]),full],coverageWindow).reason,'initial_frame_history_may_have_wrapped');
  assert.equal(assessHistoryCoverage([snapshot(90n,[]),snapshot(1100n,[500n])],coverageWindow).pass,true);
});

test('a delayed collection response cannot falsely extend the device observation window', () => {
  const final = snapshot(1100n,[10n]);
  final.collectedAfterNs = 950n;
  assert.equal(assessHistoryCoverage([snapshot(90n,[10n]),final],coverageWindow).reason,'observation_window_not_covered');
  final.collectedAfterNs = 1000n;
  assert.equal(assessHistoryCoverage([snapshot(90n,[10n]),final],coverageWindow).pass,true);
});

test('clock mismatches and refresh changes invalidate coverage', () => {
  assert.equal(assessHistoryCoverage([snapshot(90n,[10n]),snapshot(1100n,[10n,1200n])],coverageWindow).reason,'device_clock_mismatch');
  assert.equal(assessHistoryCoverage([snapshot(90n,[10n]),snapshot(80n,[10n]),snapshot(1100n,[10n])],coverageWindow).reason,'device_clock_mismatch');
  const last = snapshot(1100n,[10n]); last.history.refreshPeriodNs = 8_333_333n;
  assert.equal(assessHistoryCoverage([snapshot(90n,[10n]),last],coverageWindow).reason,'display_refresh_changed');
});

test('pending in-window fences must resolve, including fences first seen during end drain', () => {
  const initial = snapshot(90n,[10n]);
  const pending = snapshot(800n,[10n],['700 9223372036854775807 690']);
  const resolved = snapshot(1200n,[10n],['700 900 690']);
  assert.equal(assessHistoryCoverage([initial,pending,resolved],coverageWindow).pass,true);
  assert.equal(assessHistoryCoverage([initial,pending,snapshot(1200n,[10n])],coverageWindow).reason,'unresolved_present_fence');
  assert.equal(assessHistoryCoverage([initial,snapshot(1200n,[10n],['700 9223372036854775807 690'])],coverageWindow).reason,'unresolved_present_fence');
  assert.equal(assessHistoryCoverage([initial,snapshot(1200n,[10n],['1100 9223372036854775807 1050'])],coverageWindow).pass,true);
  assert.equal(assessHistoryCoverage([initial,snapshot(1200n,[10n],['0 9223372036854775807 0'])],coverageWindow).reason,'unidentifiable_pending_fence');
});

test('static advisory makes no FPS claim and cannot bypass bad coverage', () => {
  const snapshots = [snapshot(0n,[]),snapshot(2_000_000_001n,[])];
  assert.equal(assessSurfacePresentation(snapshots,options).pass,false);
  const advisory = assessSurfacePresentation(snapshots,{...options,mode:'static-advisory'});
  assert.equal(advisory.pass,null);
  assert.equal(advisory.reason,'static_surface_no_fps_claim');
  assert.equal(advisory.observation.pass,false);
  assert.equal(assessSurfacePresentation(snapshots.slice(1),{...options,mode:'static-advisory'}).pass,false);
});

test('raw evidence and device clock bounds replay the same assessment without precision loss', () => {
  const samples = [snapshot(0n,[]),snapshot(2_000_000_001n,[1n,20_000_001n])];
  const encoded = JSON.stringify({window:{windowStartNs:options.windowStartNs,windowEndNs:options.windowEndNs},snapshots:samples.map(sample => ({
    collectedAfterNs:sample.collectedAfterNs,collectedAtNs:sample.collectedAtNs,
    raw:[String(sample.history.refreshPeriodNs),...sample.history.records.map(row => row.join(' '))].join('\n')
  }))},(_key,value) => typeof value === 'bigint' ? String(value) : value);
  const decoded = JSON.parse(encoded);
  const replay = decoded.snapshots.map(sample => ({collectedAfterNs:BigInt(sample.collectedAfterNs),collectedAtNs:BigInt(sample.collectedAtNs),history:parsePresentHistory(sample.raw)}));
  const replayOptions = {...options,windowStartNs:BigInt(decoded.window.windowStartNs),windowEndNs:BigInt(decoded.window.windowEndNs)};
  assert.deepEqual(assessSurfacePresentation(replay,replayOptions),assessSurfacePresentation(samples,options));
});

test('CLI evidence creation is exclusive, private, and records failure without contacting a device', () => {
  const directory = mkdtempSync(join(tmpdir(),'thorium-present-test-'));
  const script = fileURLToPath(new URL('./measure-game-present.mjs',import.meta.url));
  const invoke = (output, extra = []) => spawnSync(process.execPath,[script,'fixture-serial','fixture.game','0.0.1','0'.repeat(64),'60','5000','--output',output,...extra],
    {encoding:'utf8',env:{...process.env,ADB:join(directory,'nonexistent-adb')}});
  try {
    const output = join(directory,'evidence.json');
    const first = invoke(output);
    assert.equal(first.status,1);
    const original = readFileSync(output,'utf8');
    const artifact = JSON.parse(original);
    assert.equal(artifact.schema,2);
    assert.equal(artifact.publishApproved,false);
    assert.equal(artifact.invocation.pollIntervalMs,200);
    assert.equal(artifact.failure.message,'ADB measurement failed');
    assert.equal(statSync(output).mode & 0o777,0o600);
    assert.equal(invoke(output).status,1);
    assert.equal(readFileSync(output,'utf8'),original);
    const target = join(directory,'preserve.txt'), link = join(directory,'link.json');
    writeFileSync(target,'preserve'); symlinkSync(target,link);
    assert.equal(invoke(link).status,1);
    assert.equal(readFileSync(target,'utf8'),'preserve');
    const slower = join(directory,'slower.json');
    assert.equal(invoke(slower,['--poll-interval-ms','400']).status,1);
    assert.equal(JSON.parse(readFileSync(slower,'utf8')).invocation.pollIntervalMs,400);
    for (const extra of [['--poll-interval-ms','0'],['--poll-interval-ms','400','--poll-interval-ms','400'],['--poll-interval-ms','10000']]) {
      const invalid = invoke(join(directory,'invalid.json'),extra);
      assert.equal(invalid.status,1);
      assert.match(invalid.stderr,/Unsupported or repeated option/);
    }
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('a fixed observation window includes leading and trailing inactivity', () => {
  const frames = Array.from({length:1862}, (_,i) => 1n + BigInt(i)*16_666_666n);
  const options = {targetFps:60,minimumDurationMs:30000,windowStartNs:0n,windowEndNs:34_000_000_000n};
  const result = assessPresentRate(frames,options);
  assert.equal(result.pass,false);
  assert.ok(result.fps < 55);
  assert.ok(result.trailingIdleMs > 2900);
  const shifted = frames.map(time => time + 3_000_000_000n);
  assert.equal(assessPresentRate(shifted,options).pass,false);
  assert.ok(assessPresentRate(shifted,options).leadingIdleMs >= 3000);
});
