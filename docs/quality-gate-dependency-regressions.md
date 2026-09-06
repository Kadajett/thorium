# Readonly classifier regressions

The September 5 rewrite exposed two defects in the pinned third-party lint
implementation. The quality policy was not relaxed to accommodate them.
Reproducible pnpm patches in `patches/` apply during frozen-lockfile installation,
including the platform and game-host Docker builds.

## Inherited mapped properties

`ts-api-utils` 2.5.0 checked a property's original declaration but lost a mapped
readonly modifier when an interface inherited that property:

```ts
type Row = { name: string; score: number };
interface Entry extends Readonly<Row> {
  readonly id: string;
}
```

The checker incorrectly classified `Entry` as mutable. The patch follows an
interface's base types only when the inherited property has the identical
symbol. An explicit mutable redeclaration does not inherit that allowance.
Both ESM and CommonJS distribution entrypoints are patched.

## Generic cache identity

`is-immutable-type` 5.0.4 cached results using TypeScript's recursion identity.
Different instantiations can share that identity. Visiting `readonly string[]`
first could therefore allow `readonly { count: number }[]` despite its mutable
elements. Visiting mutable elements first could reject unrelated readonly arrays
and tuples. This was an acceptance bug, not just an inconvenient warning.

The cache now keys the resolved Type, which retains generic arguments and is
stable for ordinary recursive types. Both distribution entrypoints are patched.
This does not override any type's required immutability or turn off a rule.

## Evidence and maintenance

Run `pnpm test:quality`. The public ESLint configuration regressions prove:

- inherited mapped readonly fields pass;
- mutable elements fail in either declaration order;
- unrelated readonly arrays do not inherit a failure;
- recursive readonly trees pass, but mutable descendant arrays fail;
- an explicit mutable override still fails.

These tests failed before the corresponding patch and pass afterward. The
original Word score-policy and session-model checks now pass unchanged. Orbit's
whole-project gate also passes with the corrected classifier. Earlier slice
counts must be rerun because the old cache could conceal real violations.

Remove a patch only after its upstream replacement passes these regressions and
the repository gates. No upstream issue or pull request has been submitted by
this task. These local patches do not claim to prove referential transparency.
