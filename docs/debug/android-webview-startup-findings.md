# Serpent startup failure in the released Android APK

The user reported that fully closing and reopening the updated app did not help:
the upper screen/input remained broken and Serpent stayed black. This supersedes
any suggestion that the earlier lifecycle or task-placement changes resolved the
physical issue.

## Actual Android reproduction

An API 35 Google APIs x86_64 emulator was provisioned locally with two displays:
display 0 (1080 × 2400, 420 dpi) and display 2 (1240 × 1080, 320 dpi).
This is an Android reproduction, not physical Thor validation.

The APK was downloaded from GitHub tag `android-v0.1.0-dev.7`, its published
checksum verified, then installed. APK SHA-256:
`520577f2bbefb20fb81867b9556740c888a199107922ba9f971515860ae08235`.
Serpent 0.1.2 was installed through the public catalog and launched normally.
Its immutable content digest was
`abfb966bf5b633931ef2427212b5abfb8b557b2dfe38fd88846ea96225f99cf2`.

The native trace showed main on display 0/task 10 and companion on display 2/task
11, both started and resumed, with neither reporting `web-ready`. There was no
pause/stop explaining the failure. Both actual WebView 124 documents were loaded
and visible. A bounded CDP probe observed animation callbacks but zero game
canvas calls, zero painted canvas pixels, and the default 300 × 150 backing
size. The SDK had not reached game initialization.

Both surfaces had the same startup errors:

```
TypeError: Bootstrap includes an invalid Colyseus session capability
Host Bridge bootstrap response timed out after 5000ms
```

The probe is in the separate Serpent game repository at
`scripts/probe-webview.ts`. With the app running, forward its debug WebView socket
to localhost and run:

```
WEBVIEW_CDP_URL=http://127.0.0.1:9222 WEBVIEW_PROBE_MS=3000 npx tsx scripts/probe-webview.ts
```

The probe records message kinds, timing/canvas counters and sanitized exception
metadata, not capabilities, tickets, console arguments or message payloads.

## Isolated cause

The SDK bundled into Serpent 0.1.2 only accepted the literal room name
`game_session`. The shared host correctly supplies a generated room name of the
form `g_` plus 32 hexadecimal characters. A bounded inspection of the actual
native bootstrap confirmed that this was the failing predicate on both surfaces;
all other capability schema and game/session identity checks passed.

The current SDK accepts validated room names instead of hardcoding one name.
Updating the SDK source alone does not change a previously published game ZIP.
The game must publish a new immutable release containing the corrected SDK.

## Why previous checks missed it

The desktop startup/viewport fixture omitted the online `colyseus` capability.
It therefore exercised rendering without running the capability validator that
failed on Android. Those passing checks were not evidence that online startup
worked. The SDK now has an explicit serialized native-style bootstrap regression
for both surfaces, including the generated shared-host room name, ticket and
release/session identity fields. Invalid room names remain rejected.

The launcher focus failure has a separate actual-Android reproduction in
`apps/android/scripts/catalog-controller-repro.mjs`. It must not be conflated with
this pre-render game startup error.

## Release-integration failure caught during rollout

After Cinder 0.1.1 and Serpent 0.1.3 were published, the actual downloaded dev.8
APK rejected their catalog entries: both declare `runtime.sdkCompatibility` as
`^0.1.1`, while the Android parser still allowed only `0.1.0` and `^0.1.0`.
Controller-profile support alone was not enough. Dev.8 was marked with a public
compatibility warning; its immutable APK asset was not overwritten.

Dev.9 increases the Android version code again and admits the explicitly
supported SDK 0.1.1 requirements while retaining 0.1.0 support. A checked-in
snapshot of the actual public catalog now runs through the native parser in the
normal JVM test suite. It failed before the correction and passes afterward;
future unsupported requirements remain rejected. This fixture does not require
a game repository, network access, or a running game server to build the APK.

The public dev.7 → dev.8 `adb install -r` path was separately verified without
uninstalling between those releases. App-private files and preferences were
byte-for-byte unchanged across that upgrade. Local development-key APK swaps
were confined to the disposable emulator and are not a user upgrade requirement.

## Live Android result before the development-machine shutdown

The locally built dev.9 installed Serpent 0.1.3 through the public catalog. Both
native surfaces reported `web-ready active=true`. The bounded 15-second CDP
check passed exact release/digest, painted canvas, continuing draw calls and
live-world assertions on both surfaces. The companion showed 52 advancing world
tick labels. A native A press on display 2 delivered boost pressed/released only
to the owning main surface's Player Slot 0. No script exceptions were observed.
This was emulator evidence, not a released-APK or physical Thor result.

One initial post-install launch also triggered an Android input timeout: main
Activity creation to start took 6.826 seconds, with the captured main thread in
Chromium navigation under `WebView.loadUrl`. A subsequent fresh-process Serpent
launch took 1.767 seconds and a Cinder launch took 2.127 seconds at that boundary,
without another ANR event. This is an unresolved cold-start risk, not a fixed
performance claim. The machine shut down before Cinder's remaining checks and
dev.9 publication finished. Publication and final-APK verification must therefore
be checked independently of the local results above.
