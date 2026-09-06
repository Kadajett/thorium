# Android updater confirmation probe — September 6, 2026

The actual launcher prompt and Android installation-confirmation/cancellation
path passed on a disposable API 35 emulator. This is fixture-network emulator
evidence, not a live GitHub update, an accepted APK installation, or physical
Thor verification. No rewrite release was published.

## Isolation and fixtures

- AVD: `thorium_update_probe_20260906`; serial: `emulator-5566`.
- QEMU process at startup: `736088`; fresh data directory:
  `/tmp/thorium-update-probe-F6b1HJ/avd`.
- After the final passing repeat, the AVD identity was reconfirmed and only
  `emulator-5566` was stopped. Its data and evidence remain available.
- The serial/AVD name was queried before installing anything. The dedicated
  emulator initially contained no Thorium packages. Existing emulator `5554`,
  physical devices, and their public apps/data were not touched.
- Base: `dev.yougotserved.thorium.debug`, code 10, `0.1.0-dev.10-debug`.
- Candidate: same package, code 11, `0.1.0-dev.11-debug`, minSdk 29.
- Both used a newly generated disposable signing key. Certificate SHA-256:
  `0bc4bda398d35cf830b173c228806029d30c6101be08883176a8cc3873b67ecb`.
- No user app data or signing secrets were copied. Candidate code 11 was never
  installed; the base remained code 10 after cancellation.

The isolated Gradle configuration is
`/tmp/thorium-update-probe-F6b1HJ/fixture.init.gradle`. It redirects build outputs,
selects fixture versions/signing, attaches fixture assets, and chooses the test
runner without changing the repository's public version or Gradle configuration.

| Artifact                                                           | SHA-256                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `build-10/outputs/apk/debug/app-debug.apk`                         | `f396306393d876c0083eaae5fa78f79b9326b967e757d7870371655b7e7b7b67` |
| `build-10/outputs/apk/androidTest/debug/app-debug-androidTest.apk` | `37808bb46b39d2d83e32435a3e624aaf9ff7ffb9fe06911f30339d8129593fc0` |
| `assets/candidate.apk`                                             | `896e01bf1f68b48c236e0919bb4b9635332f45e7adfb2855407f02ada18aa3fa` |
| `assets/thorium-android-update.json`                               | `74b6eb74e46eb6a7204269bcdc39d8ae55537aab17239afec597b259130c7803` |

Paths in the table are relative to `/tmp/thorium-update-probe-F6b1HJ`.

## What ran

`AppUpdatePromptDeviceTest` starts the actual `MainActivity` and injects Android
gamepad-source key events. It verifies default A dismissal without downloading,
D-pad selection of Download, B cancellation, and preservation of the previously
focused catalog node. No private Activity fields are inspected or replaced.

`AppUpdateInstallerDeviceTest` runs the actual metadata policy, checksum copy,
PackageManager archive inspection, installed-signer comparison, private download
preparation, PackageInstaller adapter, and registered nonexported receiver.

The successful installer run:

1. Explicitly selected Download with D-pad/A and reached the verified-APK prompt.
2. Opened Android's unknown-source Settings screen and enabled its visible switch
   through ordinary injected touch input. No app-ops command, shell permission
   grant, privileged installer permission, or security bypass was used.
3. Returned to the launcher. Install remained a separate explicit selection;
   the default was again Not now and no installer callback had occurred.
4. Received real `STATUS_PENDING_USER_ACTION` for session `695258628`.
5. Located the exact clickable Cancel button in the
   `com.google.android.packageinstaller` window and captured Android's
   “Do you want to update this app?” confirmation.
6. Tapped **Cancel**, never Update. Received real `STATUS_FAILURE_ABORTED` for
   the same session. The launcher left INSTALLING, cleared its tracked session,
   and preserved installed code 10 and a sentinel preference save.

The final installer log is `installer-probe-final.log` (1 test passed in
18.393 seconds). The earlier independent `installer-probe4.log` also passed
with session `186091046`.
The settled prompt log is `prompt-probe-settled.log` (2 tests passed).
These files are in the same temporary evidence directory.

Screenshots were inspected, not inferred from state assertions:

- `prompt-settled-default-not-now.png`
- `prompt-settled-download-selected.png`
- `android-unknown-source-permission.png`
- `android-system-confirmation-final.png`
- `cancelled-version10-final.png`

The system-confirmation image has SHA-256
`ef2129fbb34a00e6e908427bd7581cc85456f97b6522614b9bc9d0ee214fa2ba`.
The cancelled-state image has SHA-256
`8d12311cb7fa329d5dc1c3032f43912bfc2c27cc745cda4d87010bec616c9b20`.
The emulator display was 1080×1920; this does not establish Thor layout or FPS.

## Test composition and guardrails

The new application-composition interface is implemented only by the
instrumentation `AppUpdateProbeApplication`. Normal Android `Application`
instances do not implement it and retain the real GitHub HTTP adapter.
No Intent extra, game message, network field, or runtime setting selects test
behavior. The real installed identity, package eligibility, APK signer checks,
permission checks, and installer adapter remain in use even in the probe.

The fixture HTTP adapter supplies a bounded release list, the actual generated
metadata, and candidate bytes. It does not contact or publish a fake GitHub
release. The optional receiver observer runs only after existing action/session
validation and records the actual Android callback for instrumentation.

Probe classes live only in `androidTest`. They require explicit
`disposableSerial=emulator-5566`, emulator hardware, and a fixture-certificate
match before modifying test app state. Without the opt-in argument they skip,
as the existing two-invocation local-save probe does. A wrong argument/device or
signer fails rather than bypassing production policy.

## Repeating the instrumented checks

Use only the recorded disposable serial. Do not substitute the current user
device. Before repeating the installer test, disable “Allow from this source”
through that disposable app's visible Android Settings screen **outside** the
instrumentation invocation. Android may kill the app when revoking that grant;
doing this inside the test previously terminated its instrumentation process.

```sh
adb -s emulator-5566 shell am instrument -w -r \
  -e disposableSerial emulator-5566 \
  -e class dev.yougotserved.thorium.AppUpdatePromptDeviceTest \
  dev.yougotserved.thorium.debug.test/dev.yougotserved.thorium.AppUpdateProbeRunner

adb -s emulator-5566 shell am instrument -w -r \
  -e disposableSerial emulator-5566 \
  -e class dev.yougotserved.thorium.AppUpdateInstallerDeviceTest \
  dev.yougotserved.thorium.debug.test/dev.yougotserved.thorium.AppUpdateProbeRunner
```

Initial probe failures are retained in the evidence directory. Android Compose
text required accessibility-tree traversal instead of find-by-text. An earlier
substring check for Cancel matched launcher prose before Android's window had
appeared; its “confirmation visible” log line and early screenshot are invalid
evidence. The final assertion requires the exact system package and clickable
button. No production background-launch-policy workaround was needed:
ActivityTaskManager recorded `BAL_ALLOW_VISIBLE_WINDOW` for CONFIRM_INSTALL.
The final prompt test also waits for the initial D-pad focus move and the
visible overlay heading before recording focus or screenshots. Reading the
accessibility cache before the queued catalog command settled gave an earlier
false focus comparison; no launcher behavior was changed to address it.

## Source checks

- Full native JVM suite: 227 passed, including 28 updater tests.
- Typed `detektDebugAndroidTest`: passed with the final probe sources.
- Typed native main/unit analysis: 209 main and 36 unit findings elsewhere;
  no updater/MainActivity findings and no compiler-resolution errors.
- Required repository `pnpm check:quality`: failed with 554 TypeScript findings.
- Documentation formatting and `git diff --check`: clean.

These failures remain release blockers; there is no baseline waiver.

Android documents that `USER_ACTION_REQUIRED` produces the pending-user-action
callback; the probe verifies its real delivery and cancellation here.
[PackageInstaller contract](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams)
