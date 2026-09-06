# Manual-test publication, 2026-09-06

The owner requested publication for manual testing on their Thor. This is not
physical-device acceptance or a passing result from the normal strict release
gate. Known quality and performance failures remain documented in
[the dev.10 release notes](android-dev10-manual-test.md).

## Android

[Dev.10 APK](https://github.com/Kadajett/thorium/releases/download/android-v0.1.0-dev.10/thorium-developer-debug.apk)
is public, with version code 10 and the same developer signing certificate as
dev.9. Install over the existing app without uninstalling or clearing data.
The release includes GitHub update metadata; subsequent compatible versions
can be offered by the in-app updater. See
[the build and signing evidence](android-app-updates.md#published-manual-test-build).

## Server-side games

The public catalog now selects exactly one release per package:

| Game                     | Version | Archive bytes | Archive SHA-256                                                    |
| ------------------------ | ------- | ------------: | ------------------------------------------------------------------ |
| Cinder Circuit           | 0.1.4   |        736486 | `dbad45d6b421943dacbdbf1062612482247f15041965a542a6f8c49ed65feecf` |
| Lexicon Forge            | 0.1.2   |        940877 | `d8c52bc0832c3c3533ab93da195efd42d9303167e41fbd8e6562e20093ff8957` |
| Serpent World, unchanged | 0.1.4   |        160205 | `c338970e0b961f5929d01727dd9ccf5aaedb0c8b5fb91c35a36368a7973fc108` |

An independent unauthenticated check fetched the public catalog and all three
archives, checked unique package IDs, and verified each downloaded size and
SHA-256. Public game-host readiness returned HTTP 200 with six loaded modules.
These are publication checks, not completed live multiplayer matches.

Cinder adds three starter decks, 90 authored cards, a four-encounter offline
expedition and native save restoration. Twelve card identities have illustrations;
the remaining cards are text-only. Lexicon adds offline word play and native
save restoration alongside its online duel mode. Both are independent downloadable
games; neither is bundled into the APK. The unfinished Serpent movement rewrite
was not published.

## Deployment record

The platform image was deployed through the existing infrastructure Pulumi
production stack, [update 13](https://app.pulumi.com/jeremy-ryan-stover-gmail-com/kadajett-thorium/production/updates/13).
Exactly two resources changed: the Platform component image and its Deployment
image; 26 resources were unchanged. No game-host image, database volume, edge or
networking change was made. The deployment became ready with one replica.

Platform source: `6738df044903b108f9a80927bc863f7ea1eec3ef`.
Platform image digest:
`sha256:2ddf51c2000eac7125f2d756bccd59ad899b338f025e634c4bcba8b71c2fd2e0`.
Fresh platform checks passed strict typechecking, build and 119 tests;
17 database integration tests were skipped, not passed.

A reviewed one-shot publisher Job completed at 19:00:08 UTC. It verified both
immutable candidates before writes, signed their server-module descriptors,
waited for module registration, then imported the catalog entries. It used the
existing shared host and storage, not separate game servers.

- Job: `thorium-publish-cinder014-lexicon012-20260906`.
- Publisher image digest: `sha256:798aab1d77455318d5e5cd4a1e0d645a8ae27098ccdfc0c99b7ed6567e7a3bd8`.
- Approved release-lock SHA-256: `f7209f5bb35d3a1fb77959d817aa06638ab09bf166141b5323c7d72138eada0b`.
- Cinder content digest: `b0c301ac828caab004f80e70ade9106d5ac2b063981acf6b1e4ab91fefd92dcf`.
- Lexicon content digest: `c220a6fcf31ded05d1e1b0ca4a8753c48b5fb899627bc018a893999fe55d6e40`.

The Job used a digest-pinned image, an approved content lock, no service-account
token, no retries, bounded resources and a read-only root filesystem. Only its
required signing-key file was projected; credentials are not included here.
