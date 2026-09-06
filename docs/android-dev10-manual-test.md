# Thorium dev.10 — manual Thor test

Published at the owner's explicit request for manual AYN Thor testing. This is
an unverified developer prerelease, not a claim that the rewrite or its release
gates are complete. The normal release workflow and strict limits are unchanged.

Install this APK over dev.9. Package identity and the stable developer signing
certificate are preserved; version code increases from 9 to 10. Do not uninstall
or clear app data. The older APK needs this one manual installation to gain the
updater. Later compatible GitHub releases can prompt inside Thorium, with
D-pad/A/B support and Android's final installation confirmation.

This build includes the GitHub updater, package-scoped native offline saves,
network-aware library handling, current-version catalog selection, and the paired
stick-direction fix. Games are independently published server-side, not bundled
into the APK. Installing this APK does not itself publish a game or include the
unfinished Serpent movement rewrite.

At preparation, 227 Android unit tests passed, including 28 updater tests. Real
emulator checks covered D-pad/A/B update prompts, Android installation
confirmation/cancellation, and Cinder/Lexicon save restoration across an in-place
private APK upgrade. These are not physical Thor acceptance results.

Known failures remain: the workspace quality gate reports 548 TypeScript/tooling
errors, and the typed native audit reports 209 main-source and 36 unit-test
findings outside the updater. The rewritten Lexicon candidate presented about
47 FPS on the development emulator. No 60/120 FPS or physical Thor approval is
claimed for this release. The manual-test workflow is an explicit one-off
release path, not a passing result from the normal strict workflow.

Thorium is heavily AI-assisted and human-directed. The product decisions,
constraints and acceptance remain with its developer. See the repository's
[AI-assisted development disclosure](https://github.com/Kadajett/thorium#ai-assisted-development).
