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
- `PACKAGE_ARTIFACT_DIRECTORY`: root of the immutable filesystem package store.
  It defaults to `./artifacts` locally and to `/var/lib/thorium/packages` in the
  container. Production must mount it read-write when self-service publishing
  is enabled; package files become read-only after their atomic publication.
- `DATABASE_URL`: PostgreSQL connection URL. It is optional for local
  development and required when `NODE_ENV=production`. Startup applies
  immutable, checksum-recorded migrations transactionally under a database
  advisory lock. PostgreSQL is also the production catalog metadata store;
  the in-memory sample catalog is only used when this setting is absent.

The filesystem adapter expects this immutable layout:

```text
PACKAGE_ARTIFACT_DIRECTORY/
  dev.yougotserved.tap-race/
    0.1.0/
      dev.yougotserved.tap-race-0.1.0.zip
```

Missing roots or files produce a package 404. A stored archive whose verified
size or digest differs from the catalog is never served.

## Self-service Game Release publishing

The public publisher API is a deliberately small first-night flow. It creates
or logs in a publisher from HTTP Basic credentials, returns one opaque scoped
publish token, then accepts the deploy descriptor and ZIP produced by
`thorium-game pack`. It has no email or account-registration dependency.

Choose a 3-40 character username using lowercase letters, numbers, `.`, `_`,
or `-`, and a password with at least 12 Unicode characters, at most 256 UTF-8
bytes, and no control characters. Usernames are normalized to lowercase. Ask
`curl` to prompt for the password so the Basic
credential is not placed in shell history or its process arguments:

```sh
umask 077
export THORIUM_PLATFORM_URL=https://games.yougotserved.dev
curl --fail-with-body --silent --show-error \
  --user 'your.publisher.name' \
  --request POST \
  "$THORIUM_PLATFORM_URL/v1/publishers/token" \
  > .thorium-publish-token.json
```

The response is shaped like this:

```json
{
  "token": "thp_<opaque 256-bit capability>",
  "tokenType": "Bearer",
  "scope": "game:publish"
}
```

Give an agent only the returned `thp_...` token, never the Basic username or
password. Every successful repeat of the Basic exchange rotates the publisher's
sole token and immediately invalidates the previous one. The server persists a
salted scrypt password hash and SHA-256 token digest; it never persists or logs
the password or raw token.

To publish, load the token without typing it into shell history and pass the
authorization header to `curl` through standard input rather than a visible
command argument:

```sh
export THORIUM_PUBLISH_TOKEN="$(jq -er .token < .thorium-publish-token.json)"
curl --fail-with-body --silent --show-error \
  --config /dev/stdin \
  --form 'descriptor=<dist/my-game.deploy.json' \
  --form 'archive=@dist/my-game.zip;type=application/zip' \
  "$THORIUM_PLATFORM_URL/v1/publisher/releases" <<CURL
header = "Authorization: Bearer ${THORIUM_PUBLISH_TOKEN}"
CURL
unset THORIUM_PUBLISH_TOKEN
```

`descriptor` is JSON text limited to 1 MiB. `archive` is one ZIP limited to
90 MiB so the complete multipart request stays below the current Cloudflare
100 MB request ceiling. Authorization and capacity checks happen before the
multipart body is buffered. The server verifies the same manifest, descriptor,
archive, and per-file integrity contract as the operator importer; releases
remain content-addressed and immutable. An exact same-owner retry returns
`already-published`. A package ID is claimed by its first publisher, and a
different publisher cannot release any version under it. Existing operator
package IDs are permanently reserved from self-service claims.

Self-service accepts only untrusted `web-v1` client packages. It does not load
server-side JavaScript or database migrations from an uploaded ZIP. Packages
may use the bounded generic `game_session` transport, but a manifest with
`multiplayer.requiresOnline: true` is rejected with `server_module_required`.
Game-specific matchmaking or world authority, such as the Cinder and Serpent
servers, remains a separately reviewed and operator-signed game-host module
deployment.

First-night containment is intentionally conservative: five package IDs and
1 GiB of reserved releases per publisher, 10 GiB globally, six publish attempts
per publisher per hour, six publish attempts per source IP per minute, five
Basic exchanges per source IP per minute, and two concurrent buffered
publication requests per platform process. Byte/package reservations are
durable PostgreSQL state. Attempt limits and concurrency are process-local and
reset on restart, so a multi-replica deployment still requires edge rate
limits. The public origin must be reachable only through the trusted Cloudflare
path when `CF-Connecting-IP` is used for client addressing.

Production startup applies `0003_self_service_publishers.sql` automatically.
The long-running platform now requires a read-write mount of the existing
`PACKAGE_ARTIFACT_DIRECTORY`; no additional application secret or environment
variable is required.

## Operator Game Release import

The operator importer remains available for reserved packages and reviewed
releases. Stage a deploy descriptor and its matching ZIP on a read-only input
volume, then run the platform image as a one-shot Job with the existing
`DATABASE_URL`, `PUBLIC_BASE_URL`, and a read-write mount of
`PACKAGE_ARTIFACT_DIRECTORY`:

```sh
node dist/publication/import-game-release.js \
  /imports/dev.yougotserved.example-1.0.0.deploy.json \
  /imports/dev.yougotserved.example-1.0.0.zip
```

The importer validates the descriptor, embedded manifest, archive envelope,
and every declared file before atomically storing immutable bytes and then
cataloging the exact release. Identical reruns are safe; package/version or
artifact reuse with different content is rejected. Kubernetes RBAC controls
who may create the Job and access its database Secret and read-write package
PVC, so no publisher credential is exposed to the Job. Operator imports reserve
their package IDs against later public claims. The long-running platform shares
the same package PVC read-write with the self-service endpoint.

## Container

The Dockerfile consumes the repository pnpm lock and intentionally requires the
repository root as its build context:

```sh
docker build -f services/platform/Dockerfile -t thorium-platform .
```

The build includes only the platform service and its migrations. Game sources
and archives are not build inputs and the image starts with an empty package
directory. Production must mount the durable package volume at
`/var/lib/thorium/packages`; releases are added independently with the
operator importer above.

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
