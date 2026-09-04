# Roadmap

Work in vertical slices. Each slice ends in an observable behavior, not only a layer or schema.

Status reflects repository evidence as of 2026-09-04. “Implemented” means source exists; checklist items say where automated coverage also exists. It does not mean deployed, signed, or validated on physical Thor hardware.

## Slice 1: Local platform contract

Status: implemented and covered by platform, SDK, and Tap Race tests.

Deliver a catalog interface, `web-v1` manifest validation, the TypeScript game SDK, and a dual-surface Tap Race package. Run catalog and SDK tests locally.

Exit gate:

- [x] catalog search returns Tap Race and resolves an immutable digest;
- [x] one Account Session fixture can receive two distinct Player Slots;
- [x] main and companion entrypoints start from one Game Session bootstrap;
- [x] malformed manifests, bad surface claims, and invalid Player Slot input are rejected by the relevant boundaries.

## Slice 2: Native launcher

Status: partially implemented in Android source; Android SDK/emulator and physical-device gates remain open.

Deliver the Compose catalog/search/install shell and adapt ThorUI's two-Activity display launcher. The current launcher includes a bundled fallback plus an HTTPS remote catalog/download path; it does not include a separate detail screen.

Exit gate:

- [ ] launcher usability is recorded for touch and controller on physical Thor hardware;
- [ ] one action is observed opening distinct main and companion views on physical Thor hardware;
- [ ] the game falls back to a role switcher when only one display is eligible;
- [ ] lifecycle, WebView crash, and failed companion launch have complete native recovery UI.

## Slice 3: Verified packages and host bridge

Status: core source path implemented; publication, quarantine, and Android runtime validation remain open.

Add immutable descriptors, archive/digest verification, atomic install, origin-scoped messaging, local peer routing, quotas, and package quarantine.

Exit gate:

- [ ] a deployed package changes the production catalog without an APK update;
- [x] packer, HTTP service, and Android catalog parser have automated rejection coverage for their integrity and path boundaries;
- [x] the Android installer implements archive, entry, size, manifest, and per-file verification plus atomic promotion;
- [x] schema-2 installed records retain the integrity envelope and Android re-hashes manifest/runtime bytes before creating any Game Session; schema-1 installs fail closed until reinstalled;
- [x] the Android installer has focused JVM coverage for archive tampering, unsafe/unexpected/duplicate entries, per-file drift, noncanonical manifests, incomplete targets, atomic promotion, post-install mutation/deletion, symlink substitution, and legacy-record rejection;
- [x] `PackageDownloader` has focused JVM coverage for bounded streaming, response failures, size/digest drift, and partial-file cleanup;
- [ ] the full remote download/install path has emulator coverage;
- [x] Android source launches stored verified policy, restricts navigation to the release tree, denies undeclared WebView egress, and does not inject account tokens;
- [x] local preview and Android coordinator implement offline main/companion message routing;
- [ ] those Android restrictions and routes are verified in an emulator and on physical Thor hardware;
- [ ] crash-loop quarantine, eviction, and rollback policies are implemented.

The digest contract is external: `thorium.json` has no digest field. The deploy descriptor records manifest, file, and archive integrity; the catalog binds that descriptor to the downloadable release.

## Slice 4: Colyseus multiplayer

Status: exact-release session creation, Android exchange/bootstrap, SDK connection tooling, the generic room, and the PostgreSQL play-lease registry are implemented and tested locally. Production identity, game matchmaking, multi-device recovery, and physical-device evidence remain future work.

Add package-bound session tickets, Seat Leases, matchmaking, reconnect, authoritative rooms, and load tests. Keep the generic room narrow; game-specific authority must be an explicit deployable server module or a bounded protocol.

Exit gate:

- [x] platform tests cover one account receiving scoped tickets for multiple distinct Player Slots;
- [x] Android tests cover exact-release exchange, strict response validation, local fallback, and separate main/companion capabilities;
- [x] the SDK exposes an opt-in Colyseus connector and rejects surface input outside the scoped Player Slot lease;
- [x] online renderer loss terminates the local surface group instead of replaying consumed capabilities;
- [ ] Android obtains tickets from a production identity flow and supplies them to both surface clients;
- [ ] two devices can join, play, disconnect, and resume end to end;
- [x] room tests reject covered duplicate, stale, oversized, and unauthorized input cases;
- [x] PostgreSQL integration tests cover concurrent activation, idempotency, one-room binding, one-use admission, migrations, and supersession fencing;
- [ ] target room counts and failure recovery pass recorded production-like gates.

## Slice 5: Thor performance and controls

Status: one semantic south/A-button policy exists in Android source with unit-test coverage; the physical-device slice remains open.

Port the successful ThorUI controller behavior to the TypeScript SDK and native Compose navigation. Capture the exact device/firmware/controller profile. Measure two-WebView cold start, memory, 120/60 presentation, input latency, and sustained thermals on the Snapdragon 865 model.

Exit gate:

- [ ] every control is mapped and user-remappable;
- [ ] one physical press is recorded exactly once under every focus arrangement on Thor;
- [ ] both touch panels and simultaneous controller/touch behavior pass probes;
- [x] initial package/message budgets are enforced by the SDK and installer;
- [ ] final budgets are derived from recorded Thor performance, memory, input, and thermal measurements.

## Slice 6: Deployment

Status: future. A Dockerfile and local artifact interface exist, but no production deployment is claimed.

Build and publish the platform container and game artifacts. Add isolated Thorium Pulumi programs to `kadajett-infrastructure`, then expose the catalog/Colyseus endpoint and package CDN on new `yougotserved.dev` hostnames.

Exit gate:

- [ ] deployment is reproducible from clean checkouts;
- [ ] TLS HTTP, WebSocket upgrade, health checks, persistence, and rollback are verified externally;
- [ ] infrastructure previews and tests cover all new resources;
- [ ] deployment uses managed secrets and no credential or signing key is committed.

## Slice 7: Signed APK and first-party lane

Status: future and unverified. There is no signed release, physical Thor release gate, or Bevy lane in this repository.

Produce a signed release APK, verified App Link, update path, crash reporting, and rollback. Add a Bevy-based trusted first-party sample only after the platform lane is stable and its binary/runtime budget is measured.

Exit gate:

- [ ] clean build produces a signed APK and checksum;
- [ ] release installs and launches both surfaces on physical Thor hardware;
- [ ] remote catalog/package updates work without APK updates in a deployed environment;
- [ ] the trusted first-party Bevy lane is implemented, measured, APK-bundled, and unable to load downloaded native executable code.

## Slice 8: First public games

Status: required product acceptance work; implementation begins after the shared
runtime is deployed on a new Thorium `yougotserved.dev` hostname. Tap Race remains
an integration fixture and does not count as either public launch game.

Build the first two catalog games in parallel on the deployed platform:

- [ ] a matchmade 1v1 card game renders the shared table on the top display and
  each player's private hand and actions on the bottom display;
- [ ] hidden cards, legal moves, turn order, timers, reconnect, concession, and
  results are server-authoritative and covered by deterministic tests;
- [ ] a large-world snake game implements authoritative movement, eating,
  growth, death, spatial interest management, and fenced shard handoff rather
  than one unbounded room;
- [ ] the snake companion surface provides a useful radar, leaderboard, and
  ability/control view, then is revised from Thor playtesting;
- [ ] both games are downloadable from the public catalog and pass two-screen,
  multi-device, reconnect, abuse, and production-like load gates.
