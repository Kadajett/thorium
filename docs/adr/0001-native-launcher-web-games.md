---
status: accepted
date: 2026-09-04
---

# Use a native launcher with restricted web game packages

## Context

Thorium needs one installable dual-screen game platform whose catalog can change without publishing a new APK. The earlier ThorUI experiment provided useful controller input and motivated an Android-assisted two-Activity display host. Its Rust-to-WebAssembly UI was slow and not user friendly in product use.

Downloaded native libraries would execute with the APK's permissions, couple packages to unstable Rust/Bevy ABIs, and create unacceptable store-policy and security risk. A host-rendered custom Wasm scene interface would be secure but would recreate a UI/game framework before authors can ship small games.

## Decision

Use Kotlin/Compose for all platform UI. Run each downloaded `web-v1` Game Package in restricted WebViews with separate main and companion entrypoints. Provide a small TypeScript SDK for semantic controls, lifecycle, local peer messages, and Colyseus bootstrap.

Reuse the ThorUI Android display policy and its controller findings as inputs, not as a runtime dependency. Reserve a future Bevy option for reviewed first-party native games shipped with an APK release.

## Consequences

- Catalog and account UX use standard native Android controls and accessibility.
- Game authors can build immutable packages with familiar web tooling; production publication remains a separate deployment concern.
- Two WebViews consume more memory than one; combined memory, cold start, and sustained frame time are device gates.
- Web packages require strong origin restrictions, content verification, quotas, and capability-based host messages.
- If the trusted APK-bundled lane is implemented, games needing native performance cannot be hot-deployed through it.
- The game contract stays independent from Compose, WebView internals, Colyseus objects, and physical display IDs.
