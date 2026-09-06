# Lexicon Forge 0.1.2 presented-frame diagnosis — September 6, 2026

The unchanged private candidate still fails the strict 60 FPS presentation gate.
The final ten-second repeat measured **47.0 FPS on both surfaces**. No game
source, frozen release, APK, save, or quality threshold was changed. No release
was approved or published.

## Feedback loop and preserved state

The existing agent-runnable command reproduced the exact failure repeatedly:

```sh
THORIUM_APP_ID=dev.yougotserved.thorium.rewrite \
  node apps/android/scripts/measure-game-present.mjs \
  emulator-5554 dev.yougotserved.lexicon-forge 0.1.2 \
  c220a6fcf31ded05d1e1b0ca4a8753c48b5fb899627bc018a893999fe55d6e40 \
  60 10000 --output /tmp/thorium-word012-present-sept6-finaloriginal.json
```

That exact output path is already occupied and immutable to the harness; use a
new path to repeat. The actual invocation also redirected its console report to
the matching `.log` file. Exit status was 1, `present_rate_failed`, with continuous
frame-history coverage for both surfaces. Rates use actual Android presentation
timestamps, not an FPS label or requestAnimationFrame callback count. Both the
whole-window and unrounded inter-present thresholds remain unchanged.

- Serial: `emulator-5554`, API 35, four emulated CPUs, WebView 124.0.6367.219.
- Private installed APK SHA-256:
  `d823c04c457b7bcea9efec524361bfcd7bac9505a7dab43dea937cc97eed8155`.
- Exact frozen Word content digest: the digest in the command above.
- Main: 1920×1080 native, 960×540 CSS; companion: 1240×1080 native,
  620×540 CSS; DPR 2 on both.
- Preserved visible solo state: 15 points, level 1, FIR, turn 1, the same
  52-letter board, and “Saved on this device”. Final surface text was byte-equal
  to the pre-ablation text. No gameplay input was sent and no saves were written
  by the probes.

The feedback loop has a repeatable red verdict, but its numerical rate is not
stable enough to attribute small performance differences causally. The reduced
scenario was an idle saved solo run: no opponent, network matchmaking, word
submission, or falling-tile transition. The remaining animated rendering path
was examined through reversible runtime-only ablations, not source fixes.

## Host-load control and its limits

The second disposable updater AVD, `emulator-5566` / QEMU PID 736088, was stopped
after its own successful tests and before these measurements. Root paused its
build/quality work during this measurement window. It resumed only after the
final unchanged run completed and device ownership returned to root.

This was **not an otherwise idle workstation**. Four unrelated
`semfora-engine serve` processes each consumed about one CPU. Samples also
showed approximately 16 GiB of used swap and appreciable host I/O pressure.
Those services and user processes were neither stopped nor modified.

The historical 48.8 FPS file was written at 13:21 local time; the disposable
AVD configuration was created at 13:49. That AVD therefore cannot explain the
original failure. The original run used an earlier private APK, so it is not a
controlled APK-to-APK comparison. The later loaded 22.9 FPS run and all runs
below used the same private dev10 APK.

## Ranked hypotheses shown before ablations

1. Host scheduling/rendering contention: removing competing work should improve
   unchanged-candidate timing. Stopping the second AVD/builds did not produce a
   pass; remaining external load prevents a fully controlled conclusion.
2. Game script/layout or decorative animation work: reducing that work should
   reduce frame cost. Script/layout samples were small; pausing animations
   improved callback cadence, but merely reducing their number did not produce
   a pass.
3. WebView/emulator composition cost: small browser script/layout costs alongside
   slow actual presents would be consistent with a downstream bottleneck.
   Observations support investigating this boundary, not identifying a specific
   guilty thread or driver.
4. Measurement overhead: less frequent SurfaceFlinger polling should improve
   unchanged-candidate timing if polling is dominant. The 800 ms sample was
   slower, so this prediction was not demonstrated.

## Results

Every rate below is a ten-second actual-presentation rate. All rows are red.
Files are `/tmp/thorium-word012-present-sept6-<suffix>.json` and matching `.log`.

| Suffix            | Runtime / polling                                                | Main FPS | Companion FPS |
| ----------------- | ---------------------------------------------------------------- | -------: | ------------: |
| `quiet1`          | Original 37 animations / 200 ms                                  |     31.3 |          31.4 |
| `csspaused`       | All 37 animations paused / 200 ms                                |      1.1 |           0.1 |
| `restored200`     | All original animations restored / 200 ms                        |     47.4 |          47.5 |
| `restored800`     | Same original runtime / 800 ms                                   |     16.5 |          16.5 |
| `oneember`        | One edge-positioned original animation per surface / 200 ms      |     27.3 |          27.3 |
| `onevisibleember` | One centrally positioned original animation per surface / 200 ms |     42.9 |          42.9 |
| `finaloriginal`   | All original animations restored / 200 ms                        |     47.0 |          47.0 |

The first single-animation probe retained the first DOM animation, whose ember
travels outside the viewport. Its long idle gaps do not isolate continuous
render capacity. The follow-up retained index 2, whose original vertical base
position is 63.4% and whose complete 160 CSS-pixel movement stays inside this
540 CSS-pixel display. The original animation, duration, and opacity curve were
not replaced. This is still an altered-runtime diagnostic, never candidate
approval evidence.

The final original run recorded main p95 38.17 ms / max 54.38 ms and companion
p95 34.57 ms / max 53.83 ms. Both had 470 actual presents in the shared window.

## Browser and graphics observations

`/tmp/thorium-word012-cdp-timing-quiet1.jsonl` contains target-level CDP metrics
and approximately three seconds of additional callback observations. The
companion sample recorded 17.4 ms of script and 0.8 ms of layout; main recorded
22.0 ms of script and 4.4 ms of layout. Style recalculation was 59.4 ms and
174.8 ms, respectively. These are instrumented metric deltas, not a complete
accounting of every rendering thread or simultaneous presentation-window data.

During the paused-animation 20-second observation, callback cadence was
approximately 60.05 Hz companion and 60.03 Hz main. With original animations
restored, the corresponding observations were approximately 48.93/48.94 Hz.
The observers perform no rendering. The paused run's nearly static actual
presents explicitly demonstrate why callback cadence cannot satisfy this gate.

Source inspection matches these observations: `tickSurface` does not rebuild
the board every frame. It updates the clock/peer request once per second; solo
has no ticking timer or bot. CSS supplies 28 main and nine companion transform/
opacity ember animations. Reducing these to one continuously visible animation
per surface did not demonstrate a proportional improvement over the restored
originals, so replacing or deleting the decoration is not yet a justified fix.

A narrowly filtered live SurfaceFlinger query reported:

```text
EGL implementation : 1.4 Android META-EGL
GLES: Google (Intel), Android Emulator OpenGL ES Translator (Mesa Intel(R) Graphics (MTL)), OpenGL ES 3.0 (4.6 (Core Profile) Mesa 25.2.8-0ubuntu0.25.10.2)
```

This identifies the reported SurfaceFlinger context; it is not proof that every
WebView rendering stage uses the same path, nor a physical AYN Thor measurement.

## Cleanup and next bounded investigation

The marked disposable harness is `/tmp/thorium-word012-diagnostic.mjs`. It
saved exact animation objects/play states, paused selected objects, and restored
all 37 original running animations afterward. Temporary callback observations
finished; their global result holders and animation holders were deleted.
All CDP connections created by these probes were closed. Root's pre-existing
forward on port 32955 was left in place. No reload, installation, data clearing,
source change, or frozen artifact write occurred.

The diagnosis is incomplete: animated rendering plus this emulator/host remains
slow, but these samples do not identify a safe fix. The next useful authorized
probe would be a short system rendering trace of the unchanged idle candidate,
correlating WebView renderer, RenderThread, SurfaceFlinger, and host scheduling.
Capture a second trace around ordinary selection input without submitting a
word. That separates callback scheduling, scene/raster work, GPU/fence waits,
and input-to-present latency. A physical Thor comparison remains necessary;
neither static-screen tricks nor lowering the 60 FPS threshold is acceptable.
