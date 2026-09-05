# Visible main surface lifecycle diagnosis

Scope: Android host and the shared SDK. A host visibility-lifecycle correction
was implemented after the diagnostic replay and native regression went red.

Physical dev.6 follow-up: a full close/reopen still left Serpent black. The
correction below was therefore insufficient for the device symptom. See
[the controller and task-placement follow-up](android-input-placement-findings.md)
for the separate-task correction and the trace needed to verify native behavior.

## Runnable evidence

`node docs/debug/visible-surface-lifecycle-replay.mjs --expect-visible-progress`

Before the correction, this failed with
`Visible top surface stopped rendering after native pause message`.
The replay reads the Activity-to-lifecycle mapping and `WebSurface.onPause`
message and feeds the resulting message through the real `HostClient` and
`runGame` with a deterministic frame driver. Its source-mapping checks are
diagnostic guards, not an Android integration test.

| Replay | Before | After 60 frame opportunities | After active |
| --- | ---: | ---: | ---: |
| Pause before first frame | 0 | 0 | 1 |
| Pause after rendering begins | 3 | 3 | 4 |
| Control: omit pause message | 3 | 63 | 64 |
| Corrected native pause mapping | 3 | 63 | 64 |
| Corrected native mapping before first paint | 0 | 60 | 61 |

The same command now passes. Forced suspension controls still freeze,
demonstrating that the SDK suspension behavior remains intact.

The three `GameSurfaceLifecycleTest` tests all failed with the old native pause
behavior before the correction. They exercise paired surfaces exchanging focus,
actual stop/restart, and replacement of a WebView while its Activity is already
visible. The Activity now uses that lifecycle seam. onPause preserves rendering;
onStop suspends; onStart and onResume activate idempotently. Replacing a visible
surface activates the new WebView even if Android does not call onStart again.
Task placement was not changed.

Validation passed: `ANDROID_HOME=/home/kadajett/Android/Sdk ./gradlew
:app:testDebugUnitTest :app:lintDebug :app:assembleDebug` from `apps/android`
completed successfully in 19 seconds. The correction is prepared for the
versionCode 6 / 0.1.0-dev.6 developer prerelease; signing setup is unchanged.
An explicit unfiltered rerun, `:app:testDebugUnitTest --tests '*' --rerun`,
then passed all 99 Android JVM tests in 3 seconds. This avoids mistaking an
incremental report containing only the three changed tests for a full rerun.

This proves the SDK consequence of the emitted message. It does **not** prove
which Android lifecycle callbacks the physical Thor delivers when companion opens.
`adb devices -l` returned no devices; no Android emulator is installed.

## Ranked, falsifiable candidates

1. **A visible main Activity receives onPause.** Before correction,
   `GameSurfaceActivity.onPause` called `WebSurface.onPause`, which emitted
   `suspended`. The SDK cancels its frame
   and ceases both game ticks and peer-message flushing. Prediction: a native
   trace shows main paused but not stopped when companion opens; keeping visible
   surfaces active restores their frames. The replay confirms the message effect.
2. **Native WebView animation suspension before bridge readiness.** The same
   method invoked `WebView.onPause` even when `ready == false`; in that case no
   SDK suspension message is sent. Prediction: a cold-start trace shows native
   pause before ready, the WebView remains paused, and its first frame never
   appears; suppressing only the bridge message would not resolve this branch.
3. **Companion placement reuses or moves the main task.** Both activities are
   `singleTask` with the same default affinity; the launch supplies a display
   option but no task flags. Prediction: activity/task inspection shows the main
   moved or stopped rather than merely unfocused. Giving companion an appropriate
   separate task changes the trace. Merely moving pause logic to onStop would not
   fix an actually hidden main activity.
4. **Renderer loss under two-WebView load.** Prediction: Chromium renderer-loss
   events and the host recovery callback coincide with failure. The current
   recovery terminates online sessions, so a stable companion that stays usable
   would weaken this candidate.

## Native trace needed to resolve the remaining uncertainty

Capture activity role, lifecycle event, display ID, task ID, and bridge-ready
state around companion launch. Include onStart/onResume/onPause/onStop,
onWindowFocusChanged, and renderer loss. Do not log capabilities or bootstraps.
Then correlate native pause/stop with each game's first frame and continuing
frames. Test touching main, touching companion, Home/return, and a cold launch.

The next correctness seam should exercise the actual Activity callbacks and
verify visibility plus WebView/SDK frame progress; a unit test of a new policy
class alone would not establish Android placement or OEM lifecycle behavior.

## Framework references

- [WebView.onPause](https://developer.android.com/reference/android/webkit/WebView#onPause()): pauses animations best-effort, but does not pause JavaScript.
- [Android multi-window lifecycle and tasks](https://developer.android.com/develop/ui/views/layout/support-multi-window-mode): separate windows use separate tasks; lifecycle and visibility are distinct.
- [Activity launch policy](https://source.android.google.cn/docs/core/display/multi_display/activity-launch?hl=en): launch mode, intent flags, and display options jointly determine placement.
