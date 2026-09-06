# Signal Fleet 0.1.1 candidate verification

This is a private candidate, not a published game or a release approval.
Its directory is `../thorium-games/signal-fleet/artifacts/0.1.1`.

## Immutable identity

- Package: `dev.yougotserved.signal-fleet`, version `0.1.1`.
- Content digest: `d17273fce867403e79149652783b6d2a65858a39d838eef38a1f8200994e9747`.
- Archive: `dev.yougotserved.signal-fleet-0.1.1.zip`, 169557 bytes,
  SHA-256 `116725740663f8a85b237f3f5a152c4b76ac61e34830d03e8906c127511256f3`.
- Descriptor file SHA-256:
  `717c2e97f4e15267a51a3aaedda3ae9122d19f12bb677805b45fd5b06f43138e`.
- Server module descriptor SHA-256:
  `2b6d9c33f01bae5ffb33b7249d3de81ba7932c2e61c90ea5bdd6f2cfb4d6e3d3`.
- Server entrypoint: 745751 bytes, SHA-256
  `bbd0d7ccde87959e5670b32bad7f6001eb33f9300486aebeadd4e5a0f0da2117`.

The actual packaged manifest declares SDK `^0.1.3`, `local-save-v1`, online
support and `requiresOnline: false`. Logical main size is 960×540 and companion
620×540, with maximum DPR 2. The companion alone owns player slot 0.
The game remains an original naval-grid duel, with untimed offline AI and an
explicit online mode. It does not require a separate deployed server.

## Independent host checks

Root recomputed the four artifact hashes and ran the platform's production
`verifyPublishedGameRelease` function against the archive and descriptor.
It accepted the exact content digest and optional-online/save contract. This
verification only constructs a release value; it did not import the catalog.

The existing optional shared-host probe loaded the actual Signal 0.1.1,
Cinder 0.1.4 and Lexicon 0.1.2 server bundles together through the production
loader. All three registered distinct physical room names, a second scan added
zero modules, disposal emptied the loaded set, and original input bytes were
unchanged. Signal registered `g_e6e66487238807e812c66c498ba8afeb`.

```sh
node --import tsx services/game-host/scripts/candidate-probe/run.ts \
  ../thorium-games/signal-fleet/artifacts/0.1.1 \
  ../thorium-games/card-duel/candidates/0.1.4 \
  ../thorium-games/word-duel/artifacts/0.1.2
```

Evidence: `/tmp/thorium-shared-candidate-probe-wxeehG/evidence.json`.
The probe uses temporary signatures and fail-closed admission/registry ports.
It is load-only evidence, not a live authenticated multiplayer match, Android
test or FPS result. It did not use production signing credentials.

The producing agent reports strict compilation, whole-game quality with zero
findings, 46 passing tests, both browser suites, byte-identical repack validation
and rejection of output-directory reuse. Original 0.1.0 artifacts are retained.
Native gameplay, save, input and presentation checks are recorded separately
when their evidence has been reviewed; source checks alone do not pass them.

## Native checkpoint: functional pass, FPS not established

The exact candidate was staged in the existing private
`dev.yougotserved.thorium.rewrite` app on `emulator-5554`, API 35. Its APK
SHA-256 is `d823c04c457b7bcea9efec524361bfcd7bac9505a7dab43dea937cc97eed8155`;
WebView is 124.0.6367.219. No installation, data clear or public-package
mutation occurred.

Native A/B, D-pad, LB and Y checks covered deployment, undo, arranging/locking
the fleet, targeting, cancellation and firing. Companion alone contained the
nine private fleet cells. After force-stop, process 11413 became 12496 and
Continue restored the B1 MISS and completed AI B6 HIT without replaying that
turn. Root independently compared both stored chart HTML values before/after:
they are byte-identical, with 960×540 main and 620×540 companion viewports.
Final screenshots were also inspected. This is emulator evidence, not physical
Thor or power-loss testing.

The shell joystick probe produced no bridge control events; its D-pad positive
control did. A possible limitation is missing motion ranges on the synthetic
input device. Physical sticks remain unverified, rather than being recorded as
passed or diagnosed as a game bug.

The unchanged strict presentation test failed over 30 seconds of native
right/A/A targeting. Both surfaces presented 60 frames total, or 2.0 FPS, with
continuous frame-history coverage. Deliberate turn waits contributed to long
inter-present gaps; these are not input-to-paint latency measurements. No
animation, forced redraw, static exemption or lowered threshold was introduced.
The displayed SDK counter read 60 FPS in the screenshots, demonstrating why
callback telemetry alone is not proof of actual presentation capacity.

Root's heavy checks and browser workloads were paused during measurement.
The source/candidate files remained unchanged. All probe-owned CDP forwards
were removed; the private solo save was retained. Native online admission was
not tested by the offline staging tool.

Evidence is retained under
`../thorium-games/signal-fleet/test-output/native-011-VYeGu6`, including
`thorium-signal011-present-gameplay-20260906.json`, input logs, restart readbacks
and screenshots. No publication has occurred. The pending question about FPS
expectations for static turn-based scenes does not itself change the gate.
