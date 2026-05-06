# Architecture Docs

Internals reference for `@voltras/node-sdk`. Audience: future contributors, agents, and consumers diagnosing SDK behavior — **not** end-user tutorials.

For end-user tutorials see `docs/getting-started/` and `docs/concepts/`. For known issues see `docs/troubleshooting.md`. For migration guidance see `MIGRATION.md`.

## Index

| File | Covers |
|------|--------|
| [overview.md](./overview.md) | What the SDK is and isn't, build system, npm publish topology |
| [code-map.md](./code-map.md) | Directory tree, file responsibilities, line citations |
| [public-api.md](./public-api.md) | Inventory of every exported method/listener/type |
| [decode-pipeline.md](./decode-pipeline.md) | BLE notification → typed event trace |
| [adapters.md](./adapters.md) | Web/Node/Native/Mock adapter abstraction |
| [testing.md](./testing.md) | Test layout, MockBLEAdapter capabilities, vitest config |
| [release.md](./release.md) | Versioning, tag-driven OIDC publish, regen workflow |
| [status.md](./status.md) | Validated/unvalidated capabilities, known gaps |

## Relationship to existing docs

| Folder | Purpose | Audience |
|--------|---------|----------|
| `architecture/` (this folder) | Internals — how the SDK is built | Contributors, future Claude sessions, debuggers |
| `concepts/` | High-level mental model of SDK domain (BLE protocol, platform adapters) | New SDK consumers |
| `getting-started/` | Step-by-step tutorials per platform | New SDK consumers |
| `roadmap/` | Planned features (e.g. ReplayBLEAdapter) | Anyone planning future work |

When a topic is already authoritatively covered in `concepts/`, this folder links there rather than duplicating.

## Authoritative cross-repo references

These external audits already inventory specific SDK capabilities — link, do not duplicate:

| Path | Topic |
|------|-------|
| `coordination/research/audit-2026-05-06-untested-capabilities.md` | Every setter/listener with on-device-validated status |
| `coordination/research/audit-2026-05-06-captures.md` | Frame inventory + decoder gaps from 2,544 phase-5 frames |
| `coordination/research/audit-2026-05-06-android-repo.md` | Cross-reference vs. Beyond+ Android app |
| `coordination/integration-plans/raw-signal-architecture.md` | Active plan motivating Phase 2 SDK work |

## Conventions

- Source citations use `path:line` form so any reader can jump directly to the source.
- Protocol byte values are referenced by symbolic names from `src/voltra/protocol/constants/enums.ts`. Raw bytes live only in `voltra-private/`.
- "0.6.0+" tags new APIs added in that release. "0.6.1" is the in-flight hotfix.
