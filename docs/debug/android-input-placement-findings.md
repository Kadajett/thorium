# dev.6 controller and display follow-up

Physical report: after closing and reopening dev.6, Serpent still stayed black;
left-stick motion highlighted the top game surface; library controller input did
not work although touch did. This disproves the earlier visibility/onPause change
as a sufficient fix for the physical issue. That correction remains intact.

## Evidence and corrections

The Activity delegated D-pad keys to framework focus, and its stick commands
called Compose focus traversal instead of the already tested `CatalogFocusPolicy`.
The library now moves explicit selection for both inputs, scrolls lazy cards into
view, and requests the chosen target's focus in keyboard input mode. A/center
activate the selected item, X edits search, Y syncs, and B clears search or goes
back. The activity consumes recognized controller key events including releases.

Motion decoding recognizes JOYSTICK, GAMEPAD, and DPAD sources. It reads X/Y and
HAT_X/HAT_Y with each axis's hardware flat region, gives a deflected digital hat
priority over the stick, and sanitizes nonfinite/out-of-range samples. Mouse and
touch events remain separate. Both game Activities consume controller motion so
the unbound events cannot invoke WebView spatial-focus fallback. The native
release contract only declares a south-button binding, so no arbitrary axis IDs
or player assignments were added. Native analog steering is not implemented by
this containment change.

Both game Activities previously shared default task affinity and used singleTask.
The companion now has `${applicationId}.companion` affinity and its launch sets
NEW_TASK while keeping singleTask. This uses a separate reusable task; it does
not request MULTIPLE_TASK or create duplicates for every launch. The merged
debug manifest contains `dev.yougotserved.thorium.debug.companion` as expected.
Finishing main explicitly terminates the coordinator session and closes companion;
non-finishing recreation leaves the session alive.

Android documents [task selection by affinity and singleTask reuse](https://developer.android.com/guide/components/activities/tasks-and-back-stack#HandleAffinities).
Display options also participate in [activity placement](https://source.android.com/docs/core/display/multi_display/activity-launch).
The shared source classification and axis choices follow the
[controller input API](https://developer.android.com/games/sdk/game-controller/controller-input).

## Red-before/green-after checks

`node docs/debug/android-input-placement-replay.mjs --baseline` reads the pinned
dev.6 commit `1555b74` adapters/manifest and fails eight integration/specification checks.
Without `--baseline`, the corrected working tree passes all nine checks. Its
task specification model checks original-main visibility and repeated-companion
reuse under documented affinity rules. This is not WindowManager emulation and
does not establish physical Thor callback behavior.

The first native regression run executed 12 tests with four failures: framework
D-pad delegation, GAMEPAD source support, HAT navigation, and axis normalization.
The main-finish cleanup regression separately failed before implementation.
The existing visibility lifecycle replay remains green after these changes.

Final native gate: `ANDROID_HOME=/home/kadajett/Android/Sdk ./gradlew
:app:testDebugUnitTest --tests '*' --rerun :app:lintDebug :app:assembleDebug`
from `apps/android` passed in 18 seconds. All 104 Android JVM tests passed with
zero failures/errors. `git diff --check` and both working-tree diagnostic
replays pass. No version, signing configuration, tag, deployment, or commit was
changed; concurrent publisher/platform edits were left untouched.

## Physical confirmation

Debug builds now log `ThoriumLifecycle` and `ThoriumInput`. Lifecycle records
contain role, event, display ID, and task ID, including ready/renderer-loss events.
Controller records include only controller key/action/source and display ID;
motion logs are bounded. They omit URLs, intent contents, capabilities, account
data, text input, and game messages.

Read the bounded tags with `adb logcat -s ThoriumLifecycle:I ThoriumInput:I
ThoriumDisplay:I '*:S'`. A cold launch should show main and companion with different
task/display IDs, both reaching web-ready, and no main stop just because companion
opens. Home should stop hidden surfaces; returning should reactivate them.
Main Back/finish should also destroy companion. Library controller logs establish
whether the physical firmware delivers the expected sources and keycodes.

The nearby ThorUI physical capture reported an Xbox-style browser controller with
four axes and 17 buttons, but sampled no button presses. It does not establish
native Android button mappings. No connected Thor or installed emulator is
available in this workspace; visual rendering and native input still need that
physical trace rather than being inferred from the tests above.
