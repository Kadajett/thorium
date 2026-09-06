# Cinder 0.1.4 idle presentation and native selection

The post-publication private-emulator check does not establish the requested
60 FPS capacity. It does establish that ordinary native D-pad card selection
responded correctly in 20 checks without altering the expedition save.
This diagnosis does not authorize another release or change the FPS gate.

## Exact runtime

- ADB serial: `emulator-5554`, API 35, four emulated CPUs.
- Application: `dev.yougotserved.thorium.rewrite`, PID 11413.
- APK SHA-256: `d823c04c457b7bcea9efec524361bfcd7bac9505a7dab43dea937cc97eed8155`.
- Game: `dev.yougotserved.cinder-circuit`, version `0.1.4`.
- Content digest: `b0c301ac828caab004f80e70ade9106d5ac2b063981acf6b1e4ab91fefd92dcf`.
- WebView: `com.google.android.webview` 124.0.6367.219.
- Main: 1920×1080 native / 960×540 CSS; companion: 1240×1080 / 620×540;
  device pixel ratio 2 on both.

Both exact immutable release URLs were visible and attached. The unchanged
Ember expedition was at encounter 1, player health 40, energy 3, enemy health
24, and selected hand index 0. The public APK was not installed, stopped or
cleared by these checks. No physical Thor was attached.

## Idle presentation loop

```sh
THORIUM_APP_ID=dev.yougotserved.thorium.rewrite \
  node apps/android/scripts/measure-game-present.mjs \
  emulator-5554 dev.yougotserved.cinder-circuit 0.1.4 \
  b0c301ac828caab004f80e70ade9106d5ac2b063981acf6b1e4ab91fefd92dcf \
  60 10000 --output /tmp/thorium-cinder014-present-20260906-postrelease.json
```

The command exited 1, `present_rate_failed`. Frame-history coverage was
continuous on both surfaces. During the shared ten-second idle window, main
presented ten frames (1 FPS) and companion presented none. Both used the strict
active-surface mode; no static exemption or threshold change was applied.

The scene was mostly unchanged. This result therefore fails the literal
presentation-rate subgate but does not identify a slow rendering operation.
Adding artificial animation or repainting identical pixels would not prove
representative gameplay performance. The next probe tested actual selection
responses instead of making that change.

## Native input loop

The disposable diagnostic is
`/tmp/cinder-native014-5V6KJh/selection-latency.mts`. It validates both exact
release targets, then sends ten right/left D-pad pairs through Android
`input keyevent`, asserting the selected card index after each input. It sends
no card-play, end-turn, menu or save-write command. The index returns to its
initial value after every pair.

All 20 assertions passed. Host-clock elapsed time from starting the ADB command
to observing the expected DOM selection was:

- Minimum: 35.42 ms.
- Median: 41.95 ms.
- Maximum: 57.40 ms.

These bounds include ADB process/transport/injection and browser inspection
overhead. They are not input-to-photon measurements, individual frame costs,
or proof of a 60 FPS rendering budget. Browser probe workloads from the Signal
agent had finished before the input loop; the workstation was not certified
otherwise idle.

Evidence is `selection-latency.json` in that diagnostic directory. Before/after
native-save read replies are deeply equal after excluding only the request ID.
Both complete surface readbacks, including selected card, content, geometry and
scroll position, are also deeply equal. The `latency-before-*` and
`latency-after-*` records and screenshots preserve this comparison.

## Cleanup and remaining verification

All created CDP sockets and ADB forwards were closed. No game source, frozen
artifact, CSS animation or persistent save was modified. The marked disposable
diagnostic remains under `/tmp`, not in the production package.

The diagnosis skill directed measurement before speculative rendering changes.
No fix was justified by this idle sample. A useful next performance investigation
is a system trace around genuine card-play/encounter transitions and controller
input, correlating delivery, browser work and actual presentation. Physical
Thor behavior and sustained representative rendering remain unverified.
