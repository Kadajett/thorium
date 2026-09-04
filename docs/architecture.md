# Architecture

## Decision summary

Thorium is a native Android product shell with downloadable web games.

- Kotlin/Compose owns platform UI. Catalog/search and install/error states exist now; production account, update, and settings flows remain future work.
- Two Android Activities own independent WebViews intended for the main and companion displays. The policy and adapters exist in source but have not been validated on physical Thor hardware in this repository.
- A `web-v1` Game Package supplies separate main and companion entrypoints.
- The TypeScript SDK owns semantic controls, surface bootstrap, local peer messages, deterministic package tooling, and an opt-in Colyseus connector isolated from the small core bundle.
- The backend implements catalog/package HTTP, idempotent exact-release Game Session creation, scoped Seat Leases, and a generic Colyseus room. PostgreSQL owns the one-active-game invariant, account generations, room binding, and one-use surface admission; local development may use the matching in-memory adapter. The catalog is still compiled in memory, packages use a read-only filesystem adapter, and production identity remains open.
- Bevy is reserved as a possible trusted first-party APK-bundled lane. That lane is not implemented or validated.

This structure carries forward the useful display and controller direction from ThorUI without retaining its Rust-to-Wasm UI; the new runtime still needs its own device evidence.

## Why the launcher is native

The prior Rust/Wasm UI was measured by the product owner as slow and difficult to use. A catalog is dominated by lists, search, text, download state, focus, account flows, and accessibility. Compose supplies those as native controls and avoids instantiating the web runtime before a game starts.

WebViews remain appropriate inside a running game because the work is canvas-oriented and packages should be independently deployable. Current code and desktop tests do not establish WebView performance, graphics API support, controller behavior, or display placement on the target device; those remain physical Thor gates. Games should keep normal DOM UI small and render hot paths through Canvas/WebGL.

## Runtime topology

```text
                     platform HTTP (implemented locally)
                                  |
                     +------------v------------+
                     | Compose launcher        |
                     | catalog + package cache |
                     +------------+------------+
                                  |
                         verified Game Package
                                  |
                 +----------------+----------------+
                 | Android SessionCoordinator      |
                 | local GameSession coordination  |
                 +----------+-------------+---------+
                            |             |
                     main Activity   companion Activity
                     main WebView    companion WebView
                            |             |
                            +-- local peer bridge --+
                                  |
                    scoped, one-use surface tickets
                                  |
                         platform Colyseus room
```

The Activities are platform adapters. `SurfaceRole` is assigned by policy after Android display discovery; games never observe physical display IDs. The main and companion surface clients render independently and may run at different refresh rates. The source policy and JVM unit-test fixtures exist, but actual dual-display behavior is not yet recorded from a Thor.

## Implemented vertical path

The repository currently contains this local path:

1. `thorium-game pack` validates declared files, rejects unsafe filesystem entries, and emits a deterministic ZIP plus canonical deploy descriptor.
2. The platform service publishes catalog metadata and serves the exact ZIP over HTTP with immutable cache headers, ETag, `Content-Digest`, `HEAD`, and single-range support. Artifact bytes are checked against catalog size and SHA-256 before serving.
3. The Compose launcher queries the HTTPS catalog, downloads the selected archive, and hands it to the Android installer.
4. The installer verifies the archive envelope, entry allow-list, extraction limits, manifest hash, and per-file size/hash before atomic promotion into app-internal storage. Its schema-2 installed record retains the manifest and runtime-file integrity envelope.
5. On its launch worker, Android reloads that record and re-hashes the manifest and every runtime file before creating local authority or requesting an online capability. Missing, changed, linked, or legacy schema-1 bytes fail closed with a reinstall prompt. The host then loads only the release tree through the app-assets HTTPS origin and denies external WebView traffic unless a verified capability maps it to the configured platform origin.
6. A host-owned CSP and origin-scoped bridge constrain game code; the bridge performs the `bootstrap-request`/matching `requestId` exchange, enforces local Player Slots, capabilities, byte budgets, and per-surface sequences, routes local control/peer messages, and emits lifecycle state.
7. The native Game Session launcher derives a valid same-account seat plan from verified release policy. When the manifest selects online authority, the surface capability is present, and an Account Session adapter is configured, it requests the exact installed package ID, version, and content digest from `POST /v1/game-sessions`; otherwise it creates a local Game Session.
8. The Platform transactionally activates one durable-account play lease, superseding its prior generation, then returns separate short-lived capabilities for main and companion. The first successful admission binds all capabilities to one Colyseus room; a low-frequency durable fence stops a superseded room without a database read per input. Android gives each WebView only its own capability. Games opt into the Colyseus connector through `@thorium/game-sdk/colyseus`.

The Android implementation has focused JVM tests for catalog parsing, bounded package download and cleanup, package installation and atomic promotion, asset/launch policy, bridge validation, local coordination, display choice, and controller translation. No `androidTest` instrumentation suite exists. A configured Android SDK is required to run `pnpm check:android`; passing desktop/Node tests is not a substitute for emulator or physical Thor validation.

## Deep modules and seams

### Platform catalog

Interface: search and resolve immutable Game Releases. The current platform uses an in-memory catalog adapter behind HTTP, while Android uses an HTTPS remote client and a bundled fallback. Durable persistence, rollout state, and production operations remain behind the same seam for future adapters.

### Package installer

Interface: install a resolved release and return a verified local handle. The current Android implementation hides bounded download, archive/path validation, archive/manifest/file digest checks, extraction limits, atomic promotion into internal storage, persisted schema-2 integrity metadata, and a streaming pre-launch recheck. Legacy records remain discoverable but cannot launch until reinstalled. Resumable downloads, cache eviction, quarantine, and rollback policy remain future work.

### Game host

Interface: launch or leave a Game Session. The Android source hides Activities, display selection, WebViews, origin configuration, local message routing, lifecycle, and basic render-process recovery. A complete one-surface role switcher and user-facing recovery flow are not implemented.

### Session broker

Interface: start a verified Game Release. Android hides the fail-closed installed-byte check, valid seat-plan derivation, Account Session authorization, an idempotent exact-release exchange, strict response validation, local fallback, and per-surface launch payloads behind one call. Per-surface Player Slot sets must be disjoint. Its production factory intentionally has no Account Session adapter yet, so the stock APK uses local authority until identity is configured. The Platform's HMAC identity adapter supports local/test flows; production identity, matchmaking, ticket renewal, and process-loss recovery remain future adapters and operations.

### Controls

Interface: subscribe to semantic actions rather than Android key codes. Android currently maps only the south/A button for known games, suppresses repeats, maintains monotonic sequences, and routes one event to the main surface across focus changes. Complete Thor mapping, axes/dead zones, remapping, touch interaction, and device evidence remain future work.

## `web-v1` package contract

A package is immutable after packing:

```text
thorium.json
main/index.html
companion/index.html
assets/...
licenses/...
```

The manifest declares package identity, version, entrypoints, supported local/remote player counts, required surfaces, network room kind, SDK compatibility, archive budgets, and requested host capabilities. It does **not** contain a digest of itself or of the archive.

`thorium-game pack` creates a deterministic ZIP containing canonical `thorium.json` plus every declared file. It separately emits a canonical deploy descriptor with the manifest SHA-256, each declared file's SHA-256 and size, and the archive SHA-256 and exact byte size. Catalog metadata adds the package URL and a `contentDigest` derived from that canonical descriptor, avoiding a self-referential manifest hash.

The Android source serves installed files from an HTTPS app-assets origin. Navigation outside the exact bundled or installed release tree is rejected. Normal resource and service-worker egress is denied by native policy, while a host-owned response-header CSP grants the configured Platform origin only when that specific surface holds an issued capability; a manifest request alone is insufficient. The host bridge is registered only for the app-assets origin and validates every message. Account bearer/refresh tokens, sibling-surface tickets, and durable account IDs are never injected into JavaScript. These restrictions have policy tests but still require WebView/device validation.

For authoring, `thorium-game serve <thorium.json>` binds a development preview to `127.0.0.1`, serves only manifest-declared package files plus preview support modules, and shows both surfaces side by side. It uses synthetic Player Slots and no platform server, account credentials, or Colyseus ticket; it is not a production host.

## Same-account multiplayer

Account and player identity are separate. A request to start a two-player local game under one Account Session creates two Player Slots and short-lived Seat Leases. A lease is bound to:

- Game Session ID;
- exact Game Release digest;
- Account Session subject;
- Player Slot set;
- endpoint/device ID;
- allowed Surface Role;
- expiry and a one-use durable capability ID.

The native launcher and Platform now use numeric Player Slots `0..15` end to end. The complete local roster is distinct from each surface client's controllable slots. Ticket verification is stateless; the room then atomically admits the exact registered capability and binds the account's play lease to that room before mutating room state. A competing room cannot consume the remaining surface capability. Game messages name Player Slots, not accounts. Android exchange/bootstrap coverage uses an injected Account Session adapter; selecting and configuring the production identity provider remains open.

## Multiplayer authority lanes

The account-scoped Game Session is a play lease, not a claim that one account
owns an entire multiplayer match. A 1v1 match or world shard may contain many
account play leases while PostgreSQL still permits only one active lease per
durable account.

- Small bounded matches, such as a card duel, use a game-specific Colyseus room
  and matchmaking module. Private hands are projected only to their owning
  companion surface; the shared table is public room state.
- Large continuous worlds, such as the planned snake game, use authoritative
  spatial shards, interest management, and fenced handoff between cells.
  Colyseus may carry a shard's realtime connections, but one near-infinite room
  is not the scaling unit.
- Async or turn-based titles may persist commands/snapshots in PostgreSQL and
  use Colyseus only for presence and live delivery.

Game-specific tables and authority modules sit beside the generic catalog,
account play lease, release, and result records. Arbitrary downloadable client
code never supplies trusted server logic or database migrations.

## Performance policy

- Compose starts without a WebView; create game surfaces only after launch.
- Download, extraction, hashing, image decoding, and token refresh never run on a render thread.
- Installed releases are addressed by package ID, version, and content digest; verified extraction is promoted atomically.
- Installed games launch from their verified stored policy rather than a mutable catalog projection.
- Installed manifest and runtime bytes are streamed through SHA-256 again on the launch worker before a Game Session is created; the WebView never receives a capability for a release that fails this check.
- A surface has its own `requestAnimationFrame`; no code waits for simultaneous physical scanout.
- Local peer messages avoid a network round trip and are batched once per animation frame.
- The core SDK does not import Colyseus; online games opt into a separate subpath so local packages do not pay its bundle cost.
- Controller samples have one input authority so the same physical press is not applied twice.
- SDK and manifest versions are negotiated before loading game code.
- Initial package and message ceilings are conservative and become stable only after profiling on physical Thor hardware.
- Online renderer loss terminates the local surface group rather than reusing consumed tickets; local sessions can recreate their surfaces. Fresh-ticket process recovery remains future work.
- Cache eviction, crash-loop quarantine, and release rollback are future host policies.

## Runtime lanes

`web-v1` is the default downloadable lane. TypeScript plus Canvas/WebGL is the recommended authoring stack; libraries such as Phaser can sit above the SDK.

`native-first-party-v1` is a proposed trusted lane for Bevy games compiled into the APK. It is not implemented, packaged, measured, or validated. If added, it will share catalog metadata, Account Session, Player Slot, and Colyseus conventions but will not permit downloaded native modules.

## Infrastructure ownership

This repository contains a platform Dockerfile and a generated Tap Race artifact contract. Publishing images/artifacts and configuring Kubernetes, Cloudflare routing, DNS, secrets, persistence, and rollback remain future deployment work in the sibling `kadajett-infrastructure` repository. No public endpoint is asserted by this document.
