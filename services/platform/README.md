# Thorium platform

The platform publishes the catalog, immutable Game Package archives, and
product-level Game Session starts backed by the generic Colyseus `game_session`
room.

`GET /health` reports process liveness. `GET /ready` reports whether the
platform can currently reach its durable PostgreSQL dependency and is the
endpoint deployment systems should use before routing new work.

## Game Session contract

Native hosts start an exact installed Game Release with `POST /v1/game-sessions`.
The strict request names the package ID, semantic version, Release Descriptor
content digest, and the numeric `PlayerSlot` leases for each Surface Role:

```json
{
  "requestId": "c8112334-64a5-45a0-a8fe-f3de7129daac",
  "release": {
    "packageId": "dev.yougotserved.tap-race",
    "version": "0.1.0",
    "contentDigest": "1b1e9e2016b10b5759ba38febfa745a0f3f5bdaef21109d762674179773514d6"
  },
  "surfaces": [
    { "surfaceId": "upper", "role": "main", "playerSlots": [0] },
    { "surfaceId": "lower", "role": "companion", "playerSlots": [1] }
  ]
}
```

The bearer Account Session credential is accepted only by the native HTTP
request. `requestId` is an idempotency UUID: the first successful activation
returns `201`, and an identical retry while it remains active returns `200`
with the same Game Session and surface capability IDs. Reusing it for another
payload is rejected. A successful response has `Cache-Control: no-store` and returns
the configured `endpoint`, a `gameSessionId`, `roomName`, expiry, exact
package-bound `joinOptions`, and a separate short-lived `ticket` for each
surface. Account credentials and durable account IDs are never returned.

`PlayerSlot` is an integer from 0 through 15. Surface IDs, Surface Roles, and
slots must be unique within a start request. The total slot count must satisfy
the Game Release's minimum, maximum, local maximum, and
`sameAccountMultipleSlots` policy. Tickets are bound to the exact Game Release,
Game Session generation, surface, role, and slots. PostgreSQL atomically admits
each capability once and binds every surface to the first Colyseus room that
admits one. The Account Session must have at least 10 seconds remaining
when tickets are issued so matchmaking does not start with an unusable capability.

One active Game Session is stored per durable account, independent of how many
login sessions or devices it has. Starting another release atomically
supersedes the old generation. Connected rooms poll this durable fence outside
the input loop and disconnect when superseded. The in-memory registry is for
local development and tests only.

## Runtime configuration

Required secrets are `ACCOUNT_TOKEN_SECRET` and `SESSION_TICKET_SECRET` (at least
32 characters each). The package delivery settings are:

- `PUBLIC_BASE_URL`: externally reachable platform base URL. It defaults to
  `http://localhost:2567` for local development and must use HTTPS when
  `NODE_ENV=production`.
- `BROWSER_ALLOWED_ORIGINS`: comma-separated, exact HTTP(S) origins allowed to
  make credentialed browser requests or WebSocket connections. The secure
  default is empty. For Android WebViews this will typically include the host's
  configured asset origin, such as `https://appassets.androidplatform.net`.
  Native Android HTTP/WebSocket clients omit `Origin` and do not need an entry.
- `PACKAGE_ARTIFACT_DIRECTORY`: root of the read-only filesystem artifact
  adapter. It defaults to `./artifacts` locally and to
  `/var/lib/thorium/packages` in the container.
- `DATABASE_URL`: PostgreSQL connection URL. It is optional for local
  development and required when `NODE_ENV=production`. Startup applies
  immutable, checksum-recorded migrations transactionally under a database
  advisory lock.

The filesystem adapter expects this immutable layout:

```text
PACKAGE_ARTIFACT_DIRECTORY/
  dev.yougotserved.tap-race/
    0.1.0/
      dev.yougotserved.tap-race-0.1.0.zip
```

Missing roots or files produce a package 404. A stored archive whose verified
size or digest differs from the catalog is never served.

For a local server checkout, generate Tap Race and place it in the filesystem
adapter layout before starting the platform:

```sh
pnpm --filter @thorium/game-sdk build
pnpm --filter @thorium-game/tap-race run pack
mkdir -p services/platform/artifacts/dev.yougotserved.tap-race/0.1.0
cp games/tap-race/artifacts/dev.yougotserved.tap-race-0.1.0.zip \
  services/platform/artifacts/dev.yougotserved.tap-race/0.1.0/
```

## Container

The Dockerfile consumes the repository pnpm lock and intentionally requires the
repository root as its build context:

```sh
docker build -f services/platform/Dockerfile -t thorium-platform .
```

The build compiles the SDK and Tap Race from the locked workspace sources, then
deterministically generates and includes the finalized archive; it does not
depend on the gitignored local ZIP. Production can replace the filesystem
adapter later or mount a read-only artifact volume at `/var/lib/thorium/packages`
without changing the HTTP delivery interface.

Run the image with an HTTPS public origin, PostgreSQL, and the two secrets:

```sh
docker run --rm -p 2567:2567 \
  -e PUBLIC_BASE_URL=https://platform.example \
  -e DATABASE_URL=postgresql://thorium:password@postgres.example/thorium \
  -e BROWSER_ALLOWED_ORIGINS=https://appassets.androidplatform.net \
  -e ACCOUNT_TOKEN_SECRET=replace-with-at-least-32-characters \
  -e SESSION_TICKET_SECRET=replace-with-at-least-32-characters \
  thorium-platform
```
