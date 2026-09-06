# GitHub app updates

The in-app updater is included in the public dev.10 manual-test prerelease; it
is not included in dev.9. Its first installation is manual. Subsequent compatible
releases can be offered inside Thorium; Android still asks the user to approve
installation. This is not silent installation and does not use account tokens.

The implemented flow checks public, non-draft `android-v*` GitHub releases,
including developer prereleases, without blocking library startup. An available
update requires consent before downloading. The installed package's numeric
version code determines whether a release is newer, not its display name or
GitHub's latest stable release shortcut. A user may defer the update. The prompt
defaults to "Not now" and supports D-pad selection, A to confirm, and B to
dismiss. Successful discovery is limited to once every six hours; failed checks
have a two-minute retry backoff. Checks run when the library starts or resumes
and when its network status changes, not in a game's rendering loop.

## Release contract

The Android release workflow generates `thorium-android-update.json` from the
actual signed APK using `tools/android-update/generate.mts`. The metadata and
the APK are attached to the same release. The manifest includes schema version
1, package ID, version code/name, minimum Android SDK, APK asset name, byte
length, and SHA-256 hash. It does not supply an arbitrary download URL.

Only `dev.yougotserved.thorium.debug` releases are eligible. The private
`.rewrite` verification app must never install the public package through this
updater. The generator rejects verification packages and refuses to overwrite
existing output. APKs are limited to 256 MiB; metadata is limited to 16 KiB.
Tagged CI builds also reject a GitHub tag that does not match the actual APK
version name. The first updater release is version code 10 (`dev.10`).

Before invoking Android installation, the client must verify downloaded size
and hash, APK package/version/minimum SDK, and the same signing certificate set
as the installed app. A checksum alone is not proof of publisher identity.
Stable signing and increasing version codes remain required for in-place
updates. Never uninstall the app or clear its data as part of updating.

The discovery endpoint follows GitHub's [list releases contract](https://docs.github.com/en/rest/releases/releases#list-releases),
which supports unauthenticated access to public releases. Android installation
uses [required user action](<https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)>),
including handling the pending-confirmation callback; it does not request
permission to update packages without user action.

## Verification status

`pnpm test:android-update` runs the metadata regressions and is included in
`pnpm check:quality`, therefore also in the APK release workflow. Seven tests
currently cover identity parsing, numeric versions, missing/malformed metadata,
and asset name/size/checksum validation, including numeric and byte-limit
boundaries and release-tag identity. These tests and the focused metadata-tool
quality gate pass.

The generator was also exercised locally against the existing public dev.9 APK:
it returned package `dev.yougotserved.thorium.debug`, version code 9, minimum SDK
29, and the previously verified APK checksum. A private verification APK was
rejected without creating metadata; an existing metadata file was not replaced.

The native suite passed 227 tests, including 28 updater regressions covering
discovery, HTTP/checksum limits, identity/signers, controller consent, cancellation,
permission return and installer outcomes. The private `.rewrite` dev.10 APK also
built and installed with `adb install -r` over its dev.9 predecessor. Cinder's
actual expedition resumed with the same hand, energy, player/enemy health and
played-card history after that version upgrade. Lexicon Forge also restored its
exact 52-letter board, 15 points, FIR and turn 1. No uninstall or data clear was
used. This verifies in-place data retention, not the in-app installer flow.

The final private dev.10 APK also passed the existing real Android first-D-pad
and first-thumbstick library-navigation probes. The settled typed native check
reported no updater/MainActivity findings and no compiler-resolution errors;
209 main-source and 36 unit-test findings remain elsewhere. Update policy is
separate from GitHub/Android effect adapters so validation and failure paths
can be checked without replacing the production services.

On a separate disposable API 35 emulator, the updater used fixture HTTP with a
real, test-signed candidate APK and the production APK identity/signature and
Android installer adapters. The actual system update confirmation was verified
by its package-installer window and exact clickable Cancel button. Cancelling
produced `STATUS_FAILURE_ABORTED`, cleared the pending session, left version code
10 installed, and preserved a sentinel save. Unknown-source permission was
granted through Android's visible Settings UI, without a permission bypass.
This test did not accept installation or replace the installed app. Two further
instrumentation tests passed against the actual launcher prompt: A dismisses
the default "Not now" selection, and D-pad selection followed by B cancels
without downloading. The native suite still passes 227 tests, including the 28
updater regressions. Exact fixture identities, evidence and repeat instructions
are in [the updater probe record](android-updater-probe-verification.md).

That probe verifies the real Android confirmation/cancellation path, not a live
GitHub download-to-successful-install run. Fixture HTTP is supplied only by the
instrumentation Application; the normal Application uses the production GitHub
adapter. Intents, games, and network responses cannot select this composition.
Emulator results are not physical AYN Thor verification. The full repository
quality gate remains red. The owner explicitly requested a manual-test release,
so dev.10 was published without claiming those gates passed.

## Published manual-test build

[Dev.10 APK](https://github.com/Kadajett/thorium/releases/download/android-v0.1.0-dev.10/thorium-developer-debug.apk)
was built at commit `67bbb29ee066038823766fd5e5f0665749ed894e` by GitHub run
`34052532468`. Native tests, Android lint, APK assembly, signer verification and
update metadata generation succeeded. The integration token could not create
the release, so an authenticated operator published those exact artifacts.

The public APK has version code 10, size 30,836,416 bytes and SHA-256
`ad2ddfd01beb8731d5437aebbc2924cfc4444ad385cd125fb2cf383de38d75e6`.
Its signing certificate SHA-256 is unchanged from dev.9:
`e70b0874b3d49332a0f82cfdf6e89d81458c40008faa2816b1797963e50a7de9`.
The release includes `thorium-android-update.json` and the APK checksum.
The separate manual-test workflow now produces verified artifacts for operator
publication; it does not replace the normal strict release workflow.
