# Game performance and practice follow-up — 2026-09-05

## Device report

After installing Android dev.9, the user confirmed that the games technically
work on their AYN Thor. They reported poor Serpent performance and a distorted
companion layout, and requested a solo learning mode for Cinder. This supersedes
the previous lack of physical-device startup confirmation; it does not establish
acceptable frame pacing or validate every controller interaction.

## Shared frame-rate display

SDK 0.1.2 adds a default-on, per-surface counter to `runGame`. It counts completed
game-loop intervals using raw animation timestamps, not the clamped simulation
delta or a separate animation loop. The label updates once per second. It is
game-loop FPS / average interval, not server tick rate, GPU presentation rate,
or a claim that a static DOM/canvas repainted on every tick.

The overlay does not receive focus, intercept pointer events, read credentials,
or make network requests. Suspend resets sampling and stop removes its DOM.
Developers opt out with `runGame(game, { fpsOverlay: false })`.

The change adds no host protocol requirements. Bundles retaining the runtime
minimum `^0.1.1` run on the already published dev.9 APK. Immutable older game
releases cannot acquire the counter without rebuilding and publishing a new
release. Custom loops outside `runGame` are not automatically instrumented.

Verification: `pnpm --filter @thorium/game-sdk test` passes 30 tests, including
raw-timestamp sampling, long frames, clock reset, suspend/resume/stop, default
mounting, and opt-out. Workspace TypeScript checks passed; platform tests report
85 passing and 12 skipped database-dependent cases, not full database coverage.

## Cinder launch constraint

Solo practice needs no human opponent, but this release retains online launch
admission. Setting `requiresOnline: false` currently selects the platform's
generic room ticket instead of the signed Cinder module, breaking online duels.
Do not describe this practice mode as fully offline until optional online
admission is implemented and verified independently.
