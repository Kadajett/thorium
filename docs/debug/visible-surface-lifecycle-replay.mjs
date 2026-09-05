// Diagnostic replay, not an Android/Thor integration test.
// Replays the message that WebSurface.onPause currently emits into the real SDK.
// The caller supplies the hypothesis that the main Activity was paused while visible.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HostClient } from '../../packages/game-sdk/dist/host.js';
import { runGame } from '../../packages/game-sdk/dist/runtime.js';
import { createTestDevice, twoPlayersOneAccount } from '../../packages/game-sdk/dist/testing.js';

const source = readFileSync(new URL('../../apps/android/app/src/main/kotlin/dev/yougotserved/thorium/WebSurface.kt', import.meta.url), 'utf8');
const pauseBody = source.match(/fun onPause\(\) \{([\s\S]*?)\n    \}/)?.[1] ?? '';
const state = pauseBody.match(/post\(lifecycleMessage\("([^"]+)"\)\)/)?.[1];
assert.equal(state, 'suspended', 'Update this diagnostic if native lifecycle behavior changes');
const activitySource = readFileSync(new URL('../../apps/android/app/src/main/kotlin/dev/yougotserved/thorium/GameSurfaceActivity.kt', import.meta.url), 'utf8');
const activityPause = activitySource.match(/override fun onPause\(\) \{([\s\S]*?)\n    \}/)?.[1] ?? '';
let nativePauseSuspends;
if (activityPause.includes('surface?.onPause()')) {
  nativePauseSuspends = true;
} else {
  assert.ok(activityPause.includes('surfaceLifecycle.onPause()'), 'Unrecognized Activity mapping; update this diagnostic');
  const lifecycleSource = readFileSync(new URL('../../apps/android/app/src/main/kotlin/dev/yougotserved/thorium/GameSurfaceLifecycle.kt', import.meta.url), 'utf8');
  const lifecyclePause = lifecycleSource.match(/fun onPause\(\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.notEqual(lifecyclePause, undefined, 'Lifecycle pause seam must exist');
  const pauseCode = lifecyclePause.replace(/\/\/[^\n]*/g, '').trim();
  assert.ok(pauseCode === '' || pauseCode === 'suspendSurface()', 'Unrecognized lifecycle behavior; update this diagnostic');
  nativePauseSuspends = pauseCode === 'suspendSurface()';
}

const fixture = createTestDevice({gameId: 'dev.yougotserved.lifecycle-replay', accountSessions: twoPlayersOneAccount, controls: []});

async function replay(framesBeforePause, emitPause) {
  let receive;
  let pending;
  let ticks = 0;
  const host = new HostClient(fixture.main.bootstrap, {
    readBootstrap: async () => fixture.main.bootstrap,
    subscribe: listener => { receive = listener; return () => {}; },
    send: () => {},
  });
  const driver = {
    request: callback => { pending = callback; return 1; },
    cancel: () => { pending = undefined; },
  };
  const game = await runGame({
    main: () => ({start: () => {}, tick: () => { ticks++; }}),
    companion: () => ({start: () => {}, tick: () => {}}),
  }, {host, canvas: {width: 960, height: 540}, frameDriver: driver, autoResize: false});
  const advance = time => { const next = pending; pending = undefined; next?.(time); };
  for (let i = 0; i < framesBeforePause; i++) advance(i * 16);
  const before = ticks;
  if (emitPause) receive({kind: 'lifecycle', state});
  for (let i = 1; i <= 60; i++) advance((framesBeforePause + i) * 16);
  const after = ticks;
  receive({kind: 'lifecycle', state: 'active'});
  advance(2000);
  const afterResume = ticks;
  game.stop();
  return {before, after, afterResume};
}

const firstFrame = await replay(0, true);
const frozen = await replay(3, true);
const control = await replay(3, false);
const nativeMain = await replay(3, nativePauseSuspends);
const nativeFirstFrame = await replay(0, nativePauseSuspends);
console.log(JSON.stringify({assumption: 'main Activity pauses but remains visible when companion opens', firstFrame, frozen, control, nativePauseSuspends, nativeMain, nativeFirstFrame}, null, 2));
assert.equal(firstFrame.after, 0, 'Pause before first frame should reproduce a never-painted canvas');
assert.equal(frozen.after, frozen.before, 'Pause should reproduce a frozen last frame');
assert.equal(frozen.afterResume, frozen.after + 1, 'Active must restore rendering');
assert.ok(control.after > control.before, 'No-pause control must keep rendering');
if (process.argv.includes('--expect-visible-progress')) {
  assert.ok(nativeMain.after > nativeMain.before, 'Visible top surface stopped rendering after native pause message');
  assert.ok(nativeFirstFrame.after > 0, 'Visible top surface never painted its first frame');
}
