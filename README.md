# Thorium

> **Developer preview:** Thorium is not a consumer release. The Android app is currently version `0.1.0-dev.7` (`versionCode` 7), and the APK produced for hands-on testing is developer debug-signed. Production signing and validation on physical Thor hardware are not complete.

Thorium is a native Android game platform being built for the dual-screen AYN Thor. The repository contains a Kotlin/Compose catalog, a restricted two-WebView game host, a TypeScript game SDK, immutable package tooling, and a platform service.

The default game format is intentionally close to old browser game portals: a small immutable web bundle with separate `main` and `companion` entrypoints. Game authors use TypeScript, Canvas/WebGL, and the Thorium SDK. Android permissions, package verification, display placement, identity, and session capabilities remain host concerns rather than game APIs.

## Architecture at a glance

```text
Kotlin/Compose launcher
        |
        +-- catalog/search/download/install
        |
        +-- Android display host
              |-- main WebView ------ web-v1 main entrypoint
              `-- companion WebView - web-v1 companion entrypoint
                         |
                  Thorium game SDK
                         |
             local peer bridge + scoped Colyseus session
```

Rust-to-Wasm UI is not part of the launcher. Earlier ThorUI work informed the controller and display direction, but its Rust/Wasm UI was too slow and awkward for the product. A Bevy lane for trusted first-party games bundled into an APK is a future option, not an implemented or validated runtime.

See [architecture](docs/architecture.md), [domain language](CONTEXT.md), and the [roadmap](docs/roadmap.md).

## AI-assisted development

Thorium is heavily AI-assisted. I direct the architecture and product decisions, set the constraints, and review and test the resulting work. I do not claim that every line was written manually, and I do not treat AI output as correct or finished without review.

The motivation is personal as well as technical. I have 15 years of experience as a developer and have been through three layoffs in a row. Hands-on AI experience is now a hard requirement for almost every job I can currently find, so this project is a practical way to build that experience while working on a product I care about.

## Repository status

| Area | Implemented in this repository | Still unverified or future |
| --- | --- | --- |
| Native launcher | Dense controller-first Compose catalog, HTTPS discovery, verified download/install states, offline access to prior installs, and a two-Activity/WebView surface host; no game is bundled into or required to build the APK | Production account UI, settings/update UX, full recovery UX, and physical Thor behavior |
| Game packages | Strict `web-v1` validation, deterministic ZIP packing, canonical deploy descriptors, loopback dual-surface preview, and an offline verified publication importer | Signing and stable limits derived from Thor measurements |
| Platform HTTP | Catalog list/search/detail, immutable ZIP delivery, PostgreSQL catalog metadata, scoped self-service `web-v1` publishing, idempotent exact-release Game Session creation, a PostgreSQL one-game-per-account registry, durable one-use surface admission, and a fenced generic Colyseus room | Production identity, self-service game-specific server modules, and broader recovery/load evidence |
| Android runtime | Verified install/launch policy with pre-launch file rehashing, a one-call Game Session launcher, disjoint per-surface control leases and capabilities, deny-by-default WebView egress, lifecycle messages, and package-declared semantic button mapping | A configured production Account Session adapter, complete in-game controller remapping, and emulator/physical-device verification |
| Trusted native games | Architectural boundary only | Bevy implementation, packaging, performance measurements, and physical validation |

`thorium.json` does not contain its own digest. `thorium-game pack` emits the canonical manifest inside the archive and a separate deploy descriptor containing the manifest hash, per-file hashes, archive SHA-256, and exact archive size. The catalog publishes that integrity envelope and a content digest derived from the canonical descriptor.

## Workspace

- `apps/android`: native launcher and two-display host
- `services/platform`: catalog/package HTTP interfaces, session tickets, and Colyseus room
- `packages/game-sdk`: browser SDK, immutable packer, local preview, and test harness
- `games/tap-race`: first dual-surface package
- `crates`: native-only shared logic when Rust provides measured value

## Commands

Install and run the non-Android workspace checks:

```sh
pnpm install
pnpm check
```

`pnpm check` runs TypeScript checks/tests/builds and Rust formatting, linting, and tests. Android is a separate gate and requires a configured Android SDK (`ANDROID_HOME` or `apps/android/local.properties`):

```sh
pnpm check:android
```

Build, preview, and pack Tap Race:

```sh
pnpm --filter @thorium/game-sdk build
pnpm --filter @thorium-game/tap-race run serve
pnpm --filter @thorium-game/tap-race run pack
```

The preview binds to `127.0.0.1` and uses synthetic local Player Slots; it is development tooling, not an Android or Thor emulator. See the [SDK instructions](packages/game-sdk/README.md) and [platform service instructions](services/platform/README.md) for the lower-level commands and artifact layout.

Infrastructure definitions live in the sibling `kadajett-infrastructure` repository. Android debug builds target `https://games.yougotserved.dev` by default, but that hostname and the debug APK are developer-preview surfaces, not a production availability or support commitment. No production release signing is configured here.
