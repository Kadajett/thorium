# Tap Race

Tap Race is the smallest useful Thorium dual-screen web game:

- The main WebView renders a shared scoreboard.
- The companion WebView renders one large semantic `tap` control per local `PlayerSlot`.
- Its test fixture maps `PlayerSlot(0)` and `PlayerSlot(1)` to one host-only `AccountSession`, demonstrating couch multiplayer without exposing account identity to game JavaScript.
- The same manifest requests a short-lived Colyseus session ticket for online rooms. Tap Race itself does not handle account credentials.

```sh
pnpm install
pnpm test
pnpm run serve
pnpm run pack
```

`pnpm run serve` opens no browser automatically; it prints a loopback URL for a side-by-side `main` and `companion` preview. The local shell exercises the real Host Bridge bootstrap handshake plus semantic control and peer routing with synthetic `PlayerSlot` leases. It uses no account credentials or platform server. This preview is author tooling, not a production runtime or a claim about behavior on Thor hardware.

`npm run build` bundles TypeScript into browser JavaScript. This is the default downloadable lane and runs in two WebViews. It is not Core Wasm and does not load Bevy. Bevy remains an optional trusted first-party lane bundled into the native APK.

The generated package is already rooted for Android assets:

```text
android-assets/
└── games/dev.yougotserved.tap-race/
    ├── thorium.json
    ├── main/index.html
    ├── companion/index.html
    └── dist/game.js
```

The APK build can copy the contents of `android-assets/` directly into its assets directory without rewriting entrypoint paths.

`pnpm run pack` validates every declared path, writes the deterministic immutable ZIP to `artifacts/`, and updates `deploy-descriptor.json` with its SHA-256 and exact byte size. ZIP files are ignored because they are generated deployment artifacts; the canonical descriptor remains reviewable source metadata.
