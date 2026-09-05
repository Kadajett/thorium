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

## Published releases and verification

The existing Pulumi-managed shared host loaded both signed modules without a
restart. The narrowly scoped operator Job
`thorium-publish-cinder012-serpent014-20260905` completed successfully at roughly
13:31 UTC. It validated both complete releases before adding files, verified
each exact release-scoped room was registered, then imported catalog entries.
No existing release, archive, module, database, or PVC was removed.

| Release | Content digest | Public ZIP SHA-256 |
| --- | --- | --- |
| Cinder 0.1.2 | `00561f48024d3fa1350157a0aaac585d9658fcfd9200ea9cada5027f2ae0c571` | `5ae33ce98ac663fbace425e133cc08f56524258faa36abc919c6f896b411c4af` |
| Serpent 0.1.4 | `b9f0ff4ee5ca089c643042394a4f4d7438150626053996e3067753cd9328b082` | `c338970e0b961f5929d01727dd9ccf5aaedb0c8b5fb91c35a36368a7973fc108` |

Both ZIPs downloaded from the public origin matched these hashes. Cinder's live
four-socket check passed matchmaking, private-hand isolation, authoritative play,
reconnection, and session supersession. Serpent's live check passed two distinct
accounts in one public shard, authoritative movement, a delayed shard handoff
after about 67 seconds, and consumed-transfer rejection with application code
526. Old modules remain loaded for existing sessions (four release modules,
still two games and one shared-host process).

Pulumi `preview --expect-no-changes` passed: workload 28 unchanged, edge 7
unchanged. The operator image was pinned to
`sha256:d1bbb2e921bb92dae9fe7f48036489f0958388483a9c0fba6e215b7ee5d1aaca`,
and the reviewed release-lock SHA-256 was
`6d37f54f0a2978daf35485a76416815edc8da102b2e8c04b01f2a0fa41467a43`.

The actual public dev.9 APK on API 35 emulator downloaded/verified both games
through catalog Sync. Cinder 0.1.2 launched at 960×540 main and 620×540 companion
CSS pixels, DPR 2. Native A from the main display reached only companion's
Player Slot 0 and started practice; A played Spark Runner, Y ended the turn,
and the bot responded, reaching turn 3 on both surfaces. Main had the public
table and no hand; companion had the private hand. Both mounted the FPS overlay.
A ten-second probe observed advancing frames with no script exceptions on either
surface. These are emulator checks, not physical Thor performance measurements.

Serpent 0.1.4 also passed the exact-release ten-second Android probe: both
canvases painted, the companion tick label changed 62 times, main rendered the
live-world HUD, native A/boost reached only main's Player Slot 0, and neither
surface threw a script exception. The companion's actual canvas readback is
1240×1080 at 620×540 CSS pixels, with circular radar/controls and fitted status
cards. Native Android `screencap` confirmed the main world is displayed.

Do not interpret CDP `Page.captureScreenshot` as a blank-game failure here: on
this emulator it omitted the accelerated canvas while retaining the DOM FPS
label. The same running page had painted canvas readbacks and a visible world in
Android's native screenshot. That screenshot showed about 21 game-loop FPS;
the instrumented ten-second probe counted about 18 callbacks/second. Neither is
a Thor measurement or sufficient evidence that the user's performance complaint
is resolved. The native screenshot also places the FPS overlay below the main
page's safe-area inset, partially overlapping the shard text; desktop layout
checks do not cover that native inset interaction. Physical Thor FPS and layout
feedback remain required.

SDK 0.1.2 is separately published as GitHub prerelease `sdk-v0.1.2`; the public
tarball SHA-256 is
`5e432a0b959c1b43e1b48212bc850d723087e61f68a60a00e6fbe3c850a78624`.
The existing Android dev.9 release assets are unchanged.
