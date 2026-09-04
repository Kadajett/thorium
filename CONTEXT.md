# Thorium domain language

Use these terms in code, tests, documentation, and product copy.

**Platform**
The installed APK, backend, package store, SDK, and tooling that make games discoverable and runnable.

**Game**
The authored experience across one or two surfaces. Avoid using “app” for catalog content.

**Game Release**
An immutable catalog version identified by a package ID and semantic version, with its content digest published in the Release Descriptor or catalog envelope. The Game Package manifest does not contain its own digest.

**Release Descriptor**
The canonical external integrity record for a Game Release. It binds the manifest, declared files, and package archive to their hashes and exact sizes.

**Game Package**
The archive and verified files for one Game Release: manifest, main and companion web entrypoints, assets, and license notices.

**Game Session**
One durable account's active run of an exact Game Release, including its player slots, surfaces, and current authority attachment. PostgreSQL permits only one active Game Session per account. A multiplayer Match or World Instance connects several accounts' Game Sessions; it is not itself the per-account exclusivity record.

**Match**
A bounded, server-authoritative contest that connects multiple Game Sessions, such as a 1v1 card duel. Match membership is explicit and game-specific.

**World Instance**
A long-lived authoritative simulation that may contain many Game Sessions and spatial shards. A shard is a scaling/interest-management unit, not a separate game from the player's perspective.

**Surface Role**
The semantic destination of a projection: `main` or `companion`. It is not an Android display ID.

**Surface Client**
One WebView running one entrypoint for a Game Session. A surface client does not own canonical account state.

**Account**
The durable player identity. The one-active-Game-Session invariant is scoped here so opening another login or device cannot bypass it.

**Account Session**
One host-owned authenticated login for an Account. Its credentials never enter a Game Package.

**Player Slot**
A session-scoped gameplay identity. One Account Session may lease multiple Player Slots on one or more devices.

**Seat Lease**
A short-lived server authorization binding a Player Slot and surface client to an Account Session, Game Release digest, and Game Session.

**Host Bridge**
The origin-scoped message interface between a game and the APK. It exposes bounded platform capabilities, not Android objects or credentials.

**Local Peer Message**
A bounded message routed between the main and companion surface clients in the same APK without a server round trip.

**Authority**
The single owner of canonical multiplayer state. Online games use a Colyseus room. Offline games elect one surface client under host policy.

**Trusted First-Party Game**
A planned category for a game compiled into and reviewed with an APK release. A future native Bevy runtime may serve this category, but it is never a downloaded executable plugin.
