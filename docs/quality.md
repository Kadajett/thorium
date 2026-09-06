# Functional programming and strict quality gates

The September 5 rewrite is in progress. Enabling these gates is not evidence
that the existing application already satisfies them. There is no grandfather
baseline and no general permission to suppress findings.

## Scope and dependency direction

Thorium's platform, shared game host, game SDK, author/device tooling and all
first-party downloadable games are in scope. The Android host remains native
Kotlin/Compose. Downloadable games remain independently published `web-v1`
packages; an APK build must not depend on sibling game repositories.

Business and game rules belong in pure functions operating on deep-readonly
values. Time, randomness, input and effect results are explicit arguments.
Transitions return new state and effect descriptions; browser, Android,
network and storage adapters execute effects. Preserve structural sharing;
do not clone an entire world or serialize it on every render frame.

The pure core must not import host adapters, access browser globals, read a
clock, generate randomness, mutate incoming state, or hold class-owned state.
`core/`, `domain/`, `rules.ts` and `simulation.ts` receive functional lint rules.
Every remaining policy module must be classified and migrated; moving a rule
into an unclassified directory is not a fix. Static lint cannot prove purity
through every transitive dependency, so import direction and adapter ownership
also require review and regression tests.

Android Activity and Colyseus Room classes are framework adapters, not domain
models. Existing constructible SDK exports may temporarily delegate to factories
to preserve already published game contracts. They must not retain a second
implementation of policy. Class compatibility does not waive complexity rules.

## Enforced TypeScript and JavaScript limits

| Measure                                   | Maximum |
| ----------------------------------------- | ------: |
| Cyclomatic complexity per function        |      10 |
| Cognitive complexity per function         |      10 |
| Halstead difficulty per function          |      15 |
| Halstead volume per function              |   1,000 |
| File lines, excluding blank lines         |     400 |
| Function lines, excluding blanks/comments |      40 |
| Function statements                       |      20 |
| Parameters                                |       4 |
| Block nesting / nested callbacks          |       3 |

Test functions may have 60 lines and 30 statements. Their other limits are
unchanged. Inline disable directives cannot change the configuration and cause
a nonzero result. Generated output, packaged immutable releases, dependencies
and vendored third-party source are excluded; handwritten scripts are not.

Halstead uses pinned `estree-halstead` 0.4.0 over each function AST, including
its nested function bodies. Operators/operands are syntax-based, not estimated
from line counts. Formatting and comments do not reduce the score. Difficulty
is `(distinct operators / 2) * (total operands / distinct operands)`; volume is
`total tokens * log2(distinct operators + distinct operands)`. These are local
engineering budgets, not universal quality or effort estimates. Non-finite
results fail closed. Tests prove both thresholds reject over-budget code,
including one-line functions, callbacks and methods.

TypeScript enables `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`, and
`noFallthroughCasesInSwitch`. The quality command resolves inherited compiler
options and rejects any project that disables a required flag. Type-aware ESLint
also rejects `any`, unsafe operations, unhandled promises and non-exhaustive
switches. Deep-readonly core inputs and outputs use ordinary TypeScript readonly
types; no custom collection wrapper is required.

Two pinned dependency patches correct inherited readonly-property handling and
generic cache collisions, including a mutable-element acceptance bug. See
[the regression evidence](quality-gate-dependency-regressions.md). The same
limits apply before and after these corrections.

## Commands

From Thorium:

```sh
pnpm check:quality
pnpm check
node --import tsx tools/quality/run.mts ../thorium-games/word-duel
node --import tsx tools/quality/run.mts . services/platform/src/core/session-activation.ts
```

The same shared checker can inspect any independently installed game source
directory. The normal APK release workflow already calls `pnpm check`; it now
fails on these quality violations. It does not require absent game sources.

Android additionally uses Detekt complexity rules, included in `check:android`
and the APK release workflow. Both `detektDebug` and `detektDebugUnitTest` run
with type resolution; the debug classpath includes compiled generated Java
symbols so parameter-count analysis is not silently skipped. Composable names
follow Compose's PascalCase convention; complexity budgets are not waived.
The initial syntax-only native audit reported 276 findings. Its Kotlin metrics are not
claimed equivalent to JavaScript Halstead. Kotlin file-length/Halstead coverage,
functional policy enforcement and full source migration remain outstanding.
Retained Rust scaffolding still has its existing format/Clippy/test checks; it
has not been claimed compliant with the new TypeScript metrics.

## Rewrite checkpoint

Initial main-repository audit: 1,027 errors and one ineffective-disable warning
across current source, tests and scripts. This is a discovery count, not an
allowlist. Every violation still fails the gate.

The first platform change removes duplicated activation normalization from the
PostgreSQL and in-memory registries. Both now call one pure validator, preserving
canonical release/surface ordering and the transactional one-active-session
policy. New tests cover frozen inputs, canonical normalization, malformed roots,
duplicate/overlapping leases and release metadata exclusion.

The in-memory registry now composes immutable lifecycle/activation transitions
with private effect stores. Its regressions cover synchronous supersession,
idempotent replay, failed identifier allocation and public-result isolation.
All 119 platform tests passed against a disposable local PostgreSQL 17 instance,
including the 12 database integration tests that normally skip without a URL.

Presentation analysis is now strict, pure TypeScript behind the existing script
entrypoint. Its 17 regressions pass; replaying ten saved device surfaces matched
the prior implementation exactly. No new device-performance claim follows from
that source refactor.

Android library commands, touch events and stick timing now use immutable
reducers; Compose focus requests and callbacks are separate effect adapters.
The card/grid/toolbar modules preserve the existing layout and first-D-pad focus
behavior. New unit regressions cover explicit search activation, editing focus,
stale selections, stick hysteresis and logical layout sizing. Source/unit checks
are not a physical Thor verification.

Orbit's entire source/scripts/tests directory passes the corrected shared gate,
strict compilation, 31 tests and formatting. Its frozen release is unchanged;
the rewrite has not been packaged, device-verified or published.

SDK and game core rewrites are being developed in parallel. Remaining work
includes platform/host orchestration, storage adapters, JS-to-TS tooling
migration, Android policy/UI decomposition, Cinder and Serpent, completing the
other game refactors, and bringing all tests under the gate. Rewritten sources
invalidate prior candidate verification; frozen release artifacts are preserved.
Nothing from the rewrite is deployed or published before fresh verification.

The prior ADB functional and measured-presentation performance requirements
remain release conditions, not a reason to waive this gate.

### September 6 save and steering checkpoint

The unreleased optional local-save bridge has 17 SDK regressions and 17 native
port/protocol/grammar/dispatcher regressions. All 57 SDK tests and the complete
Android unit suite passed at this checkpoint. Save modules pass their focused
TypeScript gate; native save modules and tests have no findings in the typed
Detekt run. These checks do not yet establish SQLite durability after Android
process termination or device restart.

Runtime save validation regressions first reproduced silent transformation of
custom objects, sparse arrays, and accessor properties. The encoder now rejects
these instead of changing saved data. Concurrent-surface revision protection,
delete/recreate revision monotonicity, quotas, cancellation and unknown in-flight
write outcomes have explicit tests.

Three native controller regressions reproduced shallow diagonals being flattened
by independent axis deadzones. Paired circular stick filtering now preserves
direction outside the hardware/contract deadzone; the four direction tests and
existing controller tests pass. This native change needs a new APK and fresh
game/device verification; it is not present in public dev.9.

The isolated emulator build also demonstrated cached catalog startup while
offline, a clear refusal to start an online-required release without networking,
live Wi-Fi restoration status, and explicit D-pad/Search/A activation. This is
emulator evidence, not physical Thor evidence. No rewrite release was published.
The latest full main-repository quality run still fails with 632 errors, and the
typed native audit still has unrelated failures. No baseline waiver applies.

### SDK 0.1.3 and Android save verification

The SDK's complete source/test strict and complexity gate, formatting, and all
57 tests now pass. A private 0.1.3 tarball is available for candidate integration;
it has not been publicly released. The main-repository gate remains red with
576 findings outside that verified SDK slice.

Android instrumentation adds five actual SQLite tests, three host-bridge tests,
and a two-invocation process-restart probe. On the isolated API 35 emulator all
passed: closing/reopening, competing connections, rollback on quota failure,
package isolation, revision monotonicity, capability denial, caller namespace
rejection, main-thread delivery, and restoring a committed document from a
different process after force-stop. No physical Thor, reboot, power-loss, or
full-game save claim follows from these adapter checks.

Instrumentation source also passes typed Detekt without compiler-resolution
warnings after rebuilding the analysis dependencies. Its task is now included
in the native/release quality commands; those commands do not themselves run a
device. See [the repeatable device probe](android-local-save-verification.md).

### Shared module loader and actual candidate compatibility

The shared loader now uses a serialized effect factory with a compatibility
constructor delegating to it. Descriptor/signature/hash I/O and module startup
are separate from pure runtime contract validation. Modules are validated before
room registration, including malformed exports, room constructors, room kinds,
filter contracts and disposal callbacks. These modules remain trusted signed
server code; this does not introduce a JavaScript sandbox.

The complete game-host suite passes 42 tests. Two regression tests first
reproduced overlapping scans registering a release twice and disposal racing
initialization; both pass with the serialized operation queue. Strict host
compilation and the focused loader/tool quality checks pass without exemptions.

The repeatable load-only probe also loaded the actual frozen Cinder 0.1.3 and
Lexicon Forge 0.1.2 server bundles together through the production loader. It
confirmed distinct physical room registrations, an empty second scan and an
empty loaded set after disposal, then rechecked the original entrypoint and
descriptor bytes. Temporary copies were signed with a disposable key; original
candidate files and production signing keys were not changed. Admission and
registry ports reject calls in this load-only probe. This is not evidence of
live matchmaking, a shared database session, or game performance.

```sh
node --import tsx services/game-host/scripts/candidate-probe/run.ts \
  ../thorium-games/card-duel/candidates/0.1.3 \
  ../thorium-games/word-duel/artifacts/0.1.2
```

Only pass trusted local server candidates: this tool executes their code. It
prints the path to its retained temporary evidence JSON, including exact hashes
and registrations. The optional probe accepts paths and is not part of APK
builds; no sibling game repository is required for the launcher build. The
main-repository gate still fails; neither these candidates nor the updater have
been published by this rewrite.

### Shared registry client checkpoint

The registry client now delegates to an effect factory, with release/fence,
response-shape, service-token and byte-limit policy in its pure core. Its public
admit/check/finish interface is unchanged. Release scope is captured independently
of caller-owned objects, authenticated requests refuse redirects, and response
streams are cancelled immediately when they exceed 16 KiB instead of buffering
the complete response before rejecting it.

Two public-interface regressions reproduced caller mutation changing an existing
scope and an oversized stream being fully consumed without cancellation. Both
now pass. Fourteen registry tests cover those failures, exact byte boundaries,
cross-release rejection before HTTP, response validation and service-token
shape. The complete host suite passes 56 tests; strict compilation, build and
the focused registry source/test quality gate pass. The latest full repository
gate still fails with 548 errors. No thresholds or exclusions were changed.

## Tool references

The AST metric implementation is documented by
[estree-halstead](https://github.com/ota-meshi/estree-halstead).
Cyclomatic counting follows the pinned
[ESLint complexity rule](https://eslint.org/docs/latest/rules/complexity).
Kotlin analysis uses [Detekt](https://detekt.dev/docs/rules/complexity/).
