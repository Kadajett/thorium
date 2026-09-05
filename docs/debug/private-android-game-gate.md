# Private Android candidate testing

New games are not added to the public catalog just to test them. The released
debug APK can load a verified candidate privately on an explicitly selected,
rooted emulator. This is a diagnostic workflow, not an Android production API.

## Stage an unpublished package

Build the platform verifier first (`pnpm build`). Start the API 35 dual-display
emulator, install the public dev.9 APK, and explicitly run `adb -s SERIAL root`
on that emulator. Do not root a user's physical device for this workflow.

```sh
node apps/android/scripts/stage-local-game.mjs emulator-5554 /absolute/path/deploy-descriptor.json /absolute/path/game.zip --local-practice
```

The script uses the production archive verifier, validates the authored local
PlayerSlot plan and dev.9 SDK compatibility, stages into a content-addressed
directory, and checks each installed file's SHA-256 before requesting launch.
It neither inserts a catalog record nor grants an online capability. Existing
immutable directories are verified, not overwritten. Temporary ZIPs and failed
staging directories are retained for inspection.

This bypasses the catalog/download/admission UI deliberately. It does **not**
prove that public catalog installation or multiplayer admission works. Those
paths require separate verification before publication. No account credential
is placed in a game bootstrap.

## Evidence from 2026-09-05

All measurements below used `emulator-5554`, API 35 x86_64, host GPU rendering,
two guest CPU cores, and the unchanged public dev.9 APK:
`ade6059e78c62c2c3c9f845bfd0bd9c1342d14dca071c456dd36f7cff5eb944c`.
Main display was 1920×1080; companion display was 1240×1080. Browser viewports
were 960×540 and 620×540 at devicePixelRatio 2. Orbit's authored canvas DPR cap
was 1.5. This is **not physical AYN Thor performance evidence**.

The initial presentation sampler read Android SurfaceFlinger actual-present
timestamps, not the SDK label or a separate requestAnimationFrame callback.
It found these diagnostic differences:

| Orbit 0.1.0 diagnostic | Main FPS | Companion FPS |
| --- | ---: | ---: |
| Original, both surfaces repaint every frame | 44.64 | 36.99 |
| Live canvas DPR reduced to 1 | 47.52 | 39.16 |
| Fresh original, companion paint calls temporarily disabled | 58.89 | Not meaningfully rendering |

The two live modifications were temporary CDP probes, **not release candidates
or passing results**. Each was discarded by launching a fresh game session.
The difference points to combined drawing/compositing work; it does not isolate
whether rasterization, GPU work, or host rendering synchronization is dominant.
The original sample was the ready screen, not a completed active-gameplay gate.

Review found that the initial sampler omitted leading/trailing idle time and
did not verify ring-buffer coverage. These figures are useful differential
diagnostics, but must not be treated as final publication approval. The bounded
window sampler and tests are the required next verification step.

ADB also reproduced a native-controller defect in Orbit 0.1.0. Android delivers
semantic controller events to the owning surface (companion for slot 0); the
game listened only on main. Touch worked because it used `emitControl`, which
routes to the other surface. Orbit 0.1.1 added validated companion forwarding.
On the actual released APK, A then started the game and START paused it. The
browser regression now injects native events at their actual owner.

Orbit 0.1.2 additionally redraws the lower dashboard only when its validated
status, paddle position, connection state, or backing dimensions change.
Controller polling and heartbeat continue independently. Its lower dashboard
is a 10 Hz projection, not a claimed 60 FPS animation. A static dashboard must
not be made to paint useless frames to improve a reported number.

Lexicon Forge's initial manifest incorrectly required host SDK ^0.1.2. Private
staging rejected it before device writes. The corrected package requires
^0.1.1; bundled SDK 0.1.2's FPS overlay does not require a newer host protocol.

No new game was publicly released on the basis of these diagnostic samples.

Lexicon Forge's corrected candidate
`a88b259033cfd89b45922c868351fae3c9048776fd11cf0faedbb60010c584f2`
then passed private staging and native-control checks: A started solo training;
LB followed by Y forged `FIR` for 15 points, updating both the private board and
public arena; RB followed by B cancelled shuffle. The companion viewport and
document were both 620×540, with all 16 tiles inside the screen and no overflow.
Its first diagnostic presentation sample was 33.51 FPS main and 43.69 companion,
below the requested target. Native screen capture also showed the default FPS
label overlapping the timer; both findings were returned to the game agent.

The later fixed-window sampler passed its live coverage checks and has 17
unit/CLI regressions, including leading/trailing stalls, lost history, unresolved
fences, strict sub-60 rejection, and exclusive evidence-file creation.

```sh
pnpm test:android-game-gate
node apps/android/scripts/measure-game-present.mjs emulator-5554 PACKAGE_ID VERSION DIGEST 60 30000 --output /new/measurement.json
```

The output contains the shared Android-monotonic observation window, raw
per-poll histories, coverage verdicts, exact APK/release identity, display sizes,
CPU topology, graphics configuration properties, and active WebView version.
Graphics properties describe configuration, not proof of the actual renderer.
`--static-surface companion` marks a deliberately event-driven dashboard as
unassessed for FPS capacity (`pass: null`); it does not grant publication approval.
No nominal-refresh tolerance is enabled: a measured 59.99 remains below 60.

After restarting the emulator with four guest CPU cores (all other configured
resources unchanged), the original word candidate's active-practice sample was
28.20/40.33 FPS. Thus more guest CPUs did not establish a performance fix.
The new compositor candidate
`d1e95a304a0f4551a1985858aa1f4a2ebb33fa7b27ba91357062e341e9712893`
removed full-canvas painting and reserved header room for the FPS label. A
30-second active-practice sample on that same four-core emulator measured
46.17/46.13 FPS, with continuous frame-history coverage. Native A/LB/Y still
started practice and scored a word, and the timer was clear of the overlay.
This is improved but still not a 60 FPS pass.

Raw local evidence is retained in the sibling game's
`word-duel/artifacts/adb/word-before-compositor-four-core-active.json` and
`word-duel/artifacts/adb/word-compositor-four-core-active.json`. These are diagnostic artifacts,
not credentials or publication authorizations. For a final gate, capture
screenshots/readbacks outside the measurement window and confirm that actual
gameplay has started before collecting. The emulator may need a background tap
to establish a focused Android window before injected controller key-downs;
this observation is not a claim about physical Thor focus behavior.

## Candidate checkpoint

Games remain outside the launcher repository and outside the public catalog.

| Game | Candidate | Content digest | Status |
| --- | --- | --- | --- |
| Orbit Breaker | 0.1.2 | `d0f56fd0fd66b200898aa0d86fcdf53b3177efa910bed35dfcbdd41c3d7291eb` | Native A/START verified; diagnostic main rate about 59, below gate |
| Lexicon Forge | 0.1.0 | `d1e95a304a0f4551a1985858aa1f4a2ebb33fa7b27ba91357062e341e9712893` | Native solo verified; fixed-window rate about 46 on both surfaces |
| Vector Drift | 0.1.0 | `0bc576380241d6bc519345de3beddfb25eaeac4184306078602af68671a9a4c4` | Native throttle/countdown/steering exercised; first main sample 58.9, below gate |

Lexicon Forge has 20 rule/server tests and a four-surface multiplayer browser
check. Its server-authoritative high scores survive restart, but are scoped to
the exact release's host-managed state directory. Solo scores are not ranked.
Orbit has 14 tests; Vector has 12, including an input-only three-lap driver.
These test results do not substitute for the outstanding Android performance
and public-admission verification.

The Astra high workers began `stack-relay` and `signal-fleet` as separate sibling
projects, then received model-capacity errors. Their partial work is preserved;
neither should be treated as verified or publishable. No model substitution was
made. Resume the existing work rather than overwriting it on the next attempt.

Completed source checkpoints are local Git commits `9947112` in `orbit-breaker`,
`6822884` in `word-duel`, and `0bb9f4b` in `vector-drift`. They have no configured
remote and were not published. Frozen ZIPs remain in each game's ignored
`artifacts/` directory. Vector's raw sample is preserved under
`vector-drift/artifacts/adb/vector-drift-four-core-active.json`; that diagnostic
included canvas inspection during collection and is not a final clean FPS run.

## Startup/focus finding and clean rerun

At close-out, process 3122 was no longer alive. Android's exit history records an
ANR trace created at 10:25:10 local time, during the first post-reboot private
launch and immediate display-0 key injection. The reason is `Application does
not have a focused window`; the sampled main thread waits in HWUI
`DrawFrameTask::drawFrame` / `HardwareRenderer.syncAndDrawFrame`. The process was
eventually removed at 10:43:55. This is not enough to distinguish an emulator
startup/rendering delay from a general launch/focus defect, and it is not a
verified physical Thor bug or fix. The trace is preserved as
`vector-drift/artifacts/adb/startup-no-focused-window-anr.gz` (the trace was
created earlier during the word candidate's startup in the same app process).

A clean private Vector launch created process 6749. Both surfaces reported
`web-ready active=true` before any key was injected. Native throttle was then
sent without forcing display 0, using Android's focused display. A 30-second
run without canvas inspection measured 59.17 FPS on main; the deliberately
10 Hz dashboard was advisory-only. Both frame histories had continuous
coverage, the process stayed alive, and no new exit-history ANR appeared.
Raw evidence: `vector-drift/artifacts/adb/vector-clean-cold-launch.json`.
The clean rerun still fails the strict 60 FPS threshold.

## Screenshot caveat

On this WebView/emulator combination, CDP `Page.captureScreenshot` can omit an
accelerated canvas while showing the DOM overlay. Use Android `screencap` for
main-screen composition and explicit canvas readback for lower-canvas geometry.
A CDP-only black image is not sufficient evidence of a black game screen.

## Timestamp semantics

The parser uses the middle (actual-present) column of
[AOSP FrameTracker's history](https://android.googlesource.com/platform/frameworks/native/+/dc3d6af97d521678981c773ad9f4e1da088d7870/services/surfaceflinger/FrameTracker.h).
Zero and pending-fence sentinel values are not presented frames. A display's
refresh-period metadata alone cannot establish game FPS.
