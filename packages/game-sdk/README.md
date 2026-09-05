# Thorium game SDK

This package is the author interface for downloadable Thorium games. A game is an HTML/TypeScript Canvas or WebGL experience loaded into two WebViews: `main` and `companion`.

Authors implement only `SurfaceGame.start` and `SurfaceGame.tick` for each surface. The SDK supplies a correctly sized canvas, semantic `PlayerSlot` controls, host-routed messages between the two WebViews, and one-time bootstrap access to a short-lived Colyseus room ticket. `bootstrap.players` is the complete visible roster; `bootstrap.controlledPlayerSlots` is the smaller, surface-scoped set from which that WebView may originate input.

```ts
import { runGame, type DualSurfaceGame } from "@thorium/game-sdk";

const game: DualSurfaceGame = {
  main: () => new MainSurface(),
  companion: () => new CompanionSurface(),
};

await runGame(game);
```

The native Android host injects only the origin-scoped `window.thoriumHost.postMessage()` object supplied by `WebViewCompat.addWebMessageListener`. Bootstrap uses a request/response protocol:

```text
game -> host  { "kind": "bootstrap-request", "requestId": "bootstrap-1" }
host -> game  { "kind": "bootstrap", "requestId": "bootstrap-1", "bootstrap": { ... } }
```

`BrowserHostTransport.readBootstrap()` subscribes before sending the request, accepts only the matching response, validates the complete `GameBootstrap`, and fails after five seconds. The host response arrives through the inbound bridge (`window.__thoriumReceive` or the marked host message event). Production must validate messages again natively and expose the listener only to the installed Game Package origin.

Session capabilities, including the short-lived Colyseus ticket, belong only in the bootstrap response. They must never be placed in the WebView URL, query string, fragment, or page source. `HostClient` immediately moves the capability into private one-shot storage; `host.bootstrap` is a frozen public projection with the entire Colyseus capability omitted.

Online games can join the authoritative room without handling Colyseus authentication details:

```ts
import { createHostClient } from "@thorium/game-sdk";
import { connectAuthoritativeSession } from "@thorium/game-sdk/colyseus";

const host = await createHostClient();
const room = await connectAuthoritativeSession(host);
```

The helper returns `undefined` for a local/offline Game Session. For an online session it atomically claims the surface's ticket, installs it on a new Colyseus client, and calls `joinOrCreate("game_session", joinOptions)` with the exact Game Session and immutable Game Release scope. Once joined, automatic reconnection is eligible immediately so it can use the Platform room's 20-second recovery window.

A failed or expired attempt does not make the capability reusable. In particular, a pre-join network failure can be ambiguous—the Platform may already have consumed the one-use ticket—so the helper does not retry automatically. Return to the native host for a newly issued surface capability.

The connector is a separate package subpath and is not re-exported by `@thorium/game-sdk`. Games that only import the core runtime do not bundle the Colyseus client.

## Package validation

Version 0.1 accepts JSON manifests:

```sh
pnpm run build
node dist/cli.js validate ../../games/tap-race/android-assets/games/dev.yougotserved.tap-race/thorium.json
```

The emitted descriptor is canonical JSON with SHA-256 hashes for `thorium.json` and every package file. It contains no timestamp, so identical input produces identical output. TOML parsing is intentionally not faked; it can be added with a complete parser later.

Create the immutable deployment ZIP and descriptor together:

```sh
node dist/cli.js pack path/to/thorium.json \
  --archive artifacts/game.zip \
  --descriptor deploy-descriptor.json
```

Packing walks each declared filesystem path, rejects traversal, symlinks, and non-regular files, fixes ZIP metadata, and sorts entries. `maxFileCount` includes `thorium.json`; `maxPackageBytes` is enforced against both real input bytes and the final ZIP. The descriptor records the exact archive SHA-256 and byte size.

## Publish to the catalog

Build your game's browser files first, then publish directly from its manifest:

```sh
read -r -s -p 'Publisher token: ' THORIUM_PUBLISH_TOKEN; echo
export THORIUM_PUBLISH_TOKEN
thorium-game publish path/to/thorium.json --platform https://games.yougotserved.dev
unset THORIUM_PUBLISH_TOKEN
```

The token prompt above uses Bash. An agent can instead receive the scoped token
through its environment. Obtain that token using the platform's
[Basic credential exchange](../../../services/platform/README.md#self-service-game-release-publishing).
Keep the Basic password with the publisher; give the agent only the returned token.
With a source checkout, use `node packages/game-sdk/dist/cli.js` in place of
`thorium-game` after building the SDK.

The command validates and packs the current files, uploads their descriptor and
ZIP together, and verifies the server receipt against the exact local content
digest. It prints a JSON receipt suitable for an agent or script. It does not
write a token or intermediate archive into the game directory. The platform URL
must be an HTTPS origin; upload redirects are refused. Credentials never appear
in CLI arguments or output.

An unchanged retry returns `already-published`. If a network timeout leaves the
outcome uncertain, retry the unchanged files. For a content change, increment the
manifest version and rebuild first: published versions are immutable. Sync the
Android catalog to discover the new release; the APK does not need rebuilding.

This command accepts the self-service web client lane. Games that declare
`multiplayer.requiresOnline: true` need an operator-deployed server module and
are rejected before upload. Server modules for matchmaking or authoritative
worlds run in the shared game host.

## Local dual-surface preview

Build the SDK, then serve a validated Game Package manifest:

```sh
npm run build
node dist/cli.js serve ../../games/tap-race/android-assets/games/dev.yougotserved.tap-race/thorium.json
```

The command prints a loopback URL and shows the `main` and `companion` entrypoints side by side. It serves only `thorium.json`, SDK preview support modules, and the files declared by `runtime.files`. The preview Host Bridge uses the same `bootstrap-request`/matching `requestId` handshake as Android and validates semantic control and local peer messages before routing them to the other surface.

This is local development tooling, not a production host or evidence of Thor device behavior. It binds only to `127.0.0.1` by default, creates synthetic local `PlayerSlot` leases, never supplies an `AccountSession`, account credentials, or a Colyseus ticket, and does not contact the Thorium platform.

## Runtime lanes

- Downloadable catalog games use this web lane. Native Compose owns the launcher, catalog, authentication, installation, WebView lifecycle, and display assignment.
- Bevy is optional for trusted, first-party games bundled into the APK. Bevy code is not downloadable and does not use this web package interface.
- This package does not claim to compile TypeScript to Core Wasm. TypeScript is bundled as browser JavaScript and executes in the WebViews.
