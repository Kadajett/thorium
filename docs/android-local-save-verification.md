# Android local-save verification

This is a private runtime check, not a release or a physical Thor performance
claim. It uses the production SQLite adapter and host bridge, not JVM Android
stubs. AndroidX instrumentation setup follows the
[official runner documentation](https://developer.android.com/training/testing/instrumented-tests/androidx-test-libraries/runner).

Build the app and test APK with an isolated debug application ID
`dev.yougotserved.thorium.rewrite`. Do not replace the public debug APK for this
probe. The test package must be `dev.yougotserved.thorium.rewrite.test` and target
that same isolated app. Install both verified outputs with `adb install -r`.
The probe refuses to target another application ID.

From the repository root, with `ANDROID_HOME` pointing to the SDK and
`ANDROID_SERIAL` explicitly selecting the intended device:

```sh
node --import tsx apps/android/scripts/local-save-device-probe.mts
```

The probe runs five SQLite tests and three host-bridge tests. It then writes a
fresh nonce, turn and process ID, force-stops only the isolated app, and reads
the same save in a second instrumentation invocation. The reader verifies both
the saved revision/data and a different process ID. Test failures are detected
from the runner result, not just ADB's process exit code. Only dedicated
`dev.thorium.save-test.*` and `dev.thorium.restart.*` namespaces are written;
the probe does not clear app data or delete existing game saves.

For the instrumentation source quality gate:

```sh
cd apps/android
./gradlew :app:detektDebugAndroidTest
```

September 6 evidence: all ten test invocations passed on API 35 emulator-5554,
using the private `.rewrite` APK. The four instrumentation source files passed
typed Detekt with zero findings and no compiler-resolution warnings on the
final run. All 199 JVM Android tests also passed.

The frozen Lexicon Forge 0.1.2 candidate subsequently saved through its real
WebViews, SDK 0.1.3, and native bridge. Native A started solo; LB selected the
valid hint FIR; Y submitted it for 15 points. After force-stopping the isolated
app, a new process and native A on Continue restored the exact 52-letter board,
15 points, FIR, and turn 1 on the appropriate surfaces. Process IDs changed
from 6247 to 6624. No game save or app data was cleared.

This used the production archive verifier followed by the emulator-only direct
stager, not the normal catalog installation path. Candidate digest was
`c220a6fcf31ded05d1e1b0ca4a8753c48b5fb899627bc018a893999fe55d6e40`.
The subsequent 30-second presentation measurement failed the requested 60 FPS:
both surfaces presented 48.8 FPS on this emulator. It is not publication
approval and does not establish a physical Thor frame rate.

A later 10-second reproduction on the same exact candidate and private dev.10
APK restored that same 15-point/FIR/turn-1 save again (process 8390). CDP readback
confirmed 960×540 main and 620×540 companion logical viewports. Both surfaces
presented 22.9 FPS with continuous frame-history coverage, still failing 60 FPS.
The evidence is `/tmp/thorium-word012-present-sept6-repro2.json` and its `.log`.
This run overlapped host quality work and a second disposable emulator, so it
does not isolate a game regression from host contention. It is a reproducible
failure signal for further controlled diagnosis, not release approval.

Remaining verification includes reopening that game from the launcher, device
reboot and physical Thor behavior.
A SQLite acknowledgment does not promise survival of hardware failure or
physical power loss. Game publication still requires full quality gates,
ADB gameplay checks and measured presentation performance.
