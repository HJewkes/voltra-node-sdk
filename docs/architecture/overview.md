# Overview

High-level architecture and scope of `@voltras/node-sdk`.

## Contents

- [Scope](#scope)
- [Layered architecture](#layered-architecture)
- [Build system](#build-system)
- [Publish flow](#publish-flow)
- [Ecosystem position](#ecosystem-position)

## Scope

The SDK's responsibility:

| In scope | Out of scope |
|----------|--------------|
| BLE transport (scan, connect, write, notify) | Workout analytics / VBT (in `@voltras/workout-analytics`) |
| Auth + init handshake | Set/rep persistence (caller's responsibility) |
| Frame decoding (telemetry stream + vendor frames + settings + battery) | Multi-device fleet orchestration UI |
| Typed event API (`onPerRep`, `onSummary`, ...) | LLM/MCP tool surface (in `voltras-mcp`) |
| Resistance/mode setters with available-value validation | Cross-device state aggregation |
| Cross-platform adapter selection (Web, Node, Native, Mock) | UI/UX (NativeWind, Storybook, etc. — in `voltras/mobile` + `titan-design`) |

The SDK ships only the protocol layer + a typed API. Higher-level features (reps-since-rest, VBT estimation, set lifecycle finalization) belong downstream.

## Layered architecture

```
+----------------------------------------------------+
|  index.ts — public API surface                     |
+----------------------------------------------------+
|  sdk/   — VoltraManager + VoltraClient             |
|         + notification-dispatcher + reconnect      |
+----------------------------------------------------+
|  voltra/protocol/ — encoder, decoder, vendor       |
|  voltra/models/   — typed model interfaces         |
+----------------------------------------------------+
|  bluetooth/adapters/ — Web | Node | Native | Mock  |
|  bluetooth/models/   — DiscoveredDevice            |
+----------------------------------------------------+
|  shared/ — utils, logger | errors.ts | types/      |
+----------------------------------------------------+
```

Dependencies flow strictly downward. `voltra/protocol/` knows about `shared/` only; adapters know about `voltra/protocol/` constants only via `BLE` config; `sdk/` orchestrates both. See `code-map.md` for per-file responsibilities.

## Build system

Dual CJS + ESM build with shared type declarations.

| Output | tsconfig | Entry | Notes |
|--------|----------|-------|-------|
| ESM | `tsconfig.esm.json` | `dist/esm/index.js` | `package.json`-flagged `"type":"module"` (`package.json:5`) via `build:esm-pkg` step |
| CJS | `tsconfig.cjs.json` | `dist/cjs/index.js` | Default for `require()` consumers |
| Types | `tsconfig.json` | `dist/types/index.d.ts` | Shared by both runtime builds |

Build command: `npm run build` (`package.json:65`) runs `clean → build:esm → build:cjs → build:esm-pkg`. The ESM step has a follow-up post-process: `scripts/inject-esm-require-shim.mjs` prepends `createRequire(import.meta.url)` to `dist/esm/sdk/voltra-manager.js` because that file emits literal `require()` calls to lazy-load platform adapters (see `voltra-manager.ts:537-566`).

### Subpath exports

`package.json:9-59` declares five entry points:

| Subpath | Source | Use case |
|---------|--------|----------|
| `.` (root) | `src/index.ts` | High-level API + type-only adapter exports |
| `./react` | `src/react/index.ts` | `useVoltraScanner`, `useVoltraDevice`, `useVoltra` hooks |
| `./native` | `src/bluetooth/adapters/native.ts` | Direct `NativeBLEAdapter` value (RN consumers) |
| `./node` | `src/bluetooth/adapters/node.ts` | Direct `NodeBLEAdapter` value |
| `./web` | `src/bluetooth/adapters/web.ts` | Direct `WebBLEAdapter` value |

The root entry exports adapters as **type-only** (`src/index.ts:76-78`) to prevent eager-loading of `react-native-ble-plx` / `webbluetooth` for consumers that only need the high-level API. Subpaths get values.

### Peer dependencies

`package.json:85-99`:

| Package | Why | Optional |
|---------|-----|----------|
| `react` `>=17.0.0` | `./react` hooks | yes |
| `react-native-ble-plx` `>=3.0.0` | `NativeBLEAdapter` | yes |
| `webbluetooth` `^3.4.0` | `NodeBLEAdapter` (declared as `optionalDependencies`) | yes |

Web Bluetooth has no runtime dependency — the browser provides `navigator.bluetooth`.

## Publish flow

Tag-driven OIDC trusted publish to npm. See `release.md` for full details. Summary:

1. Bump `package.json` version on `main`.
2. Tag `vX.Y.Z` and push.
3. `.github/workflows/release.yml` runs `validate` (lint + typecheck + test + build), then `publish` (with `--provenance --access public`), then creates a GitHub Release. ~90 s end-to-end.

## Ecosystem position

```
voltra-private ──generates protocol data──▶ voltra-node-sdk ──npm publish──▶ voltras/mobile
                                                  │                              ▲
                                                  └────────────────────▶ voltras-mcp
```

- **voltra-private** runs `npm run generate:protocol` (`package.json:78`) which executes `voltra-private/build.ts`, regenerating `src/voltra/protocol/data/protocol-data.generated.ts` and the `_factories/*.generated.ts` files.
- **voltras-mcp** consumes the SDK as `@voltras/node-sdk`. The MCP layer adds session/set lifecycle, channel events, and tool surfaces — none of that lives in the SDK.
- **voltras/mobile** consumes the SDK plus the `./react` subpath for hook integration.

Cross-cutting changes: update upstream first (voltra-private regen → SDK publish → consumer pin bump). See `release.md` for the regen-and-ship gotcha learned from 0.5.0 / 0.6.0.
