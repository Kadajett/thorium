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
