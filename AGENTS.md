# Working Agreement

These rules apply to the whole repository.

## Product

- Thorium is a native Android launcher and runtime for small dual-surface games on AYN Thor.
- The launcher UI is Kotlin/Compose. Do not rebuild it in Rust or WebAssembly.
- Downloadable games use the `web-v1` package contract and run in restricted WebViews.
- Bevy is reserved for trusted first-party games shipped with an APK release.
- Preserve the working ThorUI controller behavior, but move shared browser controls to TypeScript.

## Design

- Keep `AccountSession`, `PlayerSlot`, `SurfaceRole`, and `GameSession` distinct.
- One account may lease multiple player slots. Never use an account ID as a player ID.
- Games receive short-lived session capabilities, never account credentials.
- Put platform policy behind the host bridge. Game code must not access Android APIs.
- Keep catalog, package storage, session transport, and identity behind testable ports.
- Use content-addressed immutable game releases and verify their hashes before launch.

## Quality

- Use strict TypeScript and validate all network/package input at runtime.
- Test through public interfaces. Keep host adapters replaceable with in-memory test adapters.
- Keep render-loop work free of catalog I/O, downloads, archive extraction, and token refresh.
- Record device behavior as evidence. Do not turn a desktop/emulator assumption into a Thor fact.
- Preserve unrelated work and never commit credentials, signing keys, or Pulumi secrets.
