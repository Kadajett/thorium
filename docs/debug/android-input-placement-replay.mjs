// Guards the actual Android adapter wiring that pure policy tests cannot reach.
// This is a source contract replay, not an emulator or physical-device test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root = new URL('../../apps/android/app/src/main/', import.meta.url);
const baselineRef = '1555b74edde0254e740c881999c2bc0fabdde45a';
const read = path => process.argv.includes('--baseline')
    ? execFileSync('git', ['show', `${baselineRef}:apps/android/app/src/main/${path}`], {cwd: new URL('../../', import.meta.url), encoding: 'utf8'})
    : readFileSync(new URL(path, root), 'utf8');
const kotlin = name => read(`kotlin/dev/yougotserved/thorium/${name}.kt`);
const failures = [];
const check = (name, condition) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`); if (!condition) failures.push(name); };
const main = kotlin('MainActivity');
const screen = kotlin('CatalogScreen');
const game = kotlin('GameSurfaceActivity');
const launcher = kotlin('DisplayLauncher');
const manifest = read('AndroidManifest.xml');
const companion = manifest.match(/<activity\s+android:name="\.CompanionGameActivity"[\s\S]*?\/>/)?.[0] ?? '';
check('D-pad commands enter launcher policy instead of framework traversal', !main.includes('usesFrameworkFocusTraversal'));
check('launcher moves explicit selection through tested policy', screen.includes('CatalogFocusPolicy.move(') && !screen.includes('focusManager.moveFocus'));
check('launcher handles controller motion through shared policy', main.includes('AndroidGamepadMotion.read(event)'));
check('game consumes recognized controller motion before WebView', game.includes('override fun dispatchGenericMotionEvent') && game.includes('GamepadMotionPolicy.recognizes(event.source, event.action)'));
check('companion has a distinct application-scoped task affinity', /android:taskAffinity="\$\{applicationId\}\.companion"/.test(companion));
check('companion requests a new task but reuses its single existing instance', launcher.includes('Intent.FLAG_ACTIVITY_NEW_TASK') && !launcher.includes('FLAG_ACTIVITY_MULTIPLE_TASK') && companion.includes('android:launchMode="singleTask"'));
check('companion launch still targets its selected display', launcher.includes('setLaunchDisplayId(target.id)'));

// Specification model of documented NEW_TASK/singleTask affinity selection.
// It does not simulate Android WindowManager or establish OEM behavior.
const affinity = companion.match(/android:taskAffinity="([^"]+)"/)?.[1] ?? '${applicationId}';
const tasks = [{id: 1, affinity: '${applicationId}', display: 0, activities: ['main']}];
function launchCompanion() {
  const existing = tasks.find(task => task.activities.includes('companion'));
  const reusable = tasks.find(task => task.affinity === affinity);
  const task = existing ?? reusable ?? {id: tasks.length + 1, affinity, display: 1, activities: []};
  if (!tasks.includes(task)) tasks.push(task);
  task.display = 1;
  if (!task.activities.includes('companion')) task.activities.push('companion');
  return task;
}
const first = launchCompanion();
const second = launchCompanion();
check('task model leaves main visible on its original display', tasks[0].display === 0 && tasks[0].activities.at(-1) === 'main');
check('task model reuses one companion task without creating duplicate surfaces', first === second && first !== tasks[0] && tasks.length === 2);
assert.deepEqual(failures, [], 'Native input/placement integration is incomplete');
