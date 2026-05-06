# Release

How the SDK versions, builds, and ships to npm.

## Contents

- [Versioning policy](#versioning-policy)
- [Tag-driven release flow](#tag-driven-release-flow)
- [OIDC trusted publishing](#oidc-trusted-publishing)
- [Regen workflow (voltra-private → SDK)](#regen-workflow-voltra-private--sdk)
- [Version history at a glance](#version-history-at-a-glance)

## Versioning policy

Semver. Public surface is everything in `src/index.ts` plus subpath entry points. The protocol layer (`voltra/protocol/`) is exported but consumers are expected to use the high-level API; protocol-internals churn within minor versions.

Breaking-change events:

- Removal or rename of public exports → major (post-1.0) or minor while pre-1.0.
- New `MessageType` strings, new event variants, new setters → minor.
- Bug fixes, decoder improvements with no API change → patch.

`@experimental` setters (`voltra-client.ts:840-963`) live under a softer compat guarantee — protocol bytes are validated but on-device behavior may shift. Their signatures are stable but listeners should not depend on subtle device-side semantics.

## Tag-driven release flow

`.github/workflows/release.yml` triggers on `push: tags: ['v*']`. End-to-end: ~90 s.

```
1. local: bump package.json version on main (or via PR)
2. local: git tag vX.Y.Z && git push origin vX.Y.Z
3. CI: validate job (npm ci → lint → typecheck → test → build)
4. CI: publish job (npm ci → build → verify version matches tag → npm publish --provenance --access public)
5. CI: github-release job (creates GitHub Release with auto-generated notes)
```

Pre-release tags (`-alpha`, `-beta`, `-rc`) are flagged as `prerelease: true` automatically (`release.yml`).

The verify-version step compares `${GITHUB_REF#refs/tags/v}` to `package.json` version and aborts on mismatch — a guard against accidental tag-version drift.

## OIDC trusted publishing

The publish step uses npm's OIDC trusted publisher flow — no `NPM_TOKEN` secret required. The workflow declares `permissions: id-token: write` and `npm publish --provenance` performs the OIDC handshake against the npm registry.

This means:

- **Local `npm publish` requires `--provenance false`** (provenance requires CI/OIDC).
- The npm package config must whitelist this repo + branch as a trusted publisher (set in npm web UI).
- A leaked `NPM_TOKEN` cannot publish; only this CI workflow can.

## Regen workflow (voltra-private → SDK)

The protocol data layer in the SDK is generated from `voltra-private`:

```
voltra-private/build.ts
   └─▶ writes voltra-node-sdk/src/voltra/protocol/data/protocol-data.generated.ts
   └─▶ writes voltra-node-sdk/src/voltra/protocol/_factories/*.generated.ts
```

Trigger: `npm run generate:protocol` (`package.json:78`) executes `npx tsx ../voltra-private/build.ts`.

The generated outputs are committed to the SDK repo so consumers don't need access to voltra-private. The raw protocol source (proprietary, NDA) stays in `voltra-private/` only.

Generated files have `// @generated — do not edit. Regenerate: npm run build` headers and are listed in `.prettierignore` to avoid format churn.

### Regen-and-ship gotcha

Lesson from 0.5.0 / 0.6.0 (see `MEMORY.md` and `coordination/research/`): a release that only regenerates the data layer (`0.5.0` was a "data-layer only" release) without surfacing the new capabilities through high-level SDK API methods leaves consumers stranded. `0.6.0` corrected this by bundling 8 new mode-config setters + 4 experimental QoL setters + typed vendor-frame events into a single release. Future practice: bundle "regen + API surface" rather than ship them as two separate minor versions.

## Version history at a glance

Source: `CHANGELOG.md`.

| Version | Date | Headline | Notes |
|---------|------|----------|-------|
| 0.6.1 | 2026-05-06 | Hotfix: `connect()` on node platform after scan | Removes platform gate on `scanAdapter` reuse. Currently sitting on `fix/scan-adapter-reuse-node` branch (unpushed as of 2026-05-06). |
| 0.6.0 | 2026-05-06 | Typed vendor-frame events, 8 mode-config setters, 4 `@experimental` QoL setters, `damperLevel` reflected in settings | Breaking: removed payload-less `onRepBoundary`/`onSetBoundary` listeners; renamed `MessageType` strings `'rep_summary'`→`'vendor_per_rep'`, `'set_summary'`→`'vendor_in_progress'`. See `MIGRATION.md`. |
| 0.5.0 | (prior) | Data-layer only — decoder fixes + field map renames | No high-level API surface; consumers had to wait for 0.6.0 to use the new validated capabilities. |
| 0.4.2 | 2026-05-05 | Per-client BLE adapter for multi-device | Multi-device writes were all routing to most-recent peripheral pre-fix. |
| 0.4.1 | 2026-05-04 | ESM `createRequire` shim + `scan(timeout)` ms unit fix | `inject-esm-require-shim.mjs` introduced; node/native adapters had been multiplying timeout by 1000 unintentionally. |
| 0.3.0 | 2026-02-16 | `MockBLEAdapter` + `VoltraManager.forMock()` | First-class mock support for tests/visual dev. |
| 0.2.1 | 2026-02-15 | Mixed-size param parsing in settings updates | Introduces `Uint16ParamIds`. |
| 0.1.1 | 2026-01-22 | BLE adapter config name mapping | SCREAMING_SNAKE → camelCase for `BLEServiceConfig`. |
| 0.1.0 | 2026-01-22 | Initial release | `VoltraClient`, `VoltraManager`, react hooks, all four core resistance setters. |

Tests at each release: 246 (early 0.5.x) → 381 (0.6.0). 0.6.1 is +1 multi-device-routing regression test. CI gates each release on green tests.

## Files-to-publish

`package.json:61-63`:

```
"files": ["dist"]
```

`dist/` is regenerated by `npm run build`; nothing under `src/` ships. Generated `_factories/*.generated.ts` files are part of the dist build because they are imported transitively from `commands.ts` and `message-types.ts`.

The `prepublishOnly` hook (`package.json:82`) runs `clean → build → test` before publishing — last-line-of-defense against shipping broken builds.
