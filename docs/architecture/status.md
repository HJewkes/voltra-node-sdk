# Status

Snapshot of validated, unvalidated, and known-broken parts of the SDK as of 2026-05-06.

For exhaustive cross-repo capability inventories see:

- `coordination/research/audit-2026-05-06-untested-capabilities.md` — every setter/listener with on-device-validated status across `voltra-private` → `voltra-node-sdk` → `voltras-mcp`.
- `coordination/research/audit-2026-05-06-captures.md` — frame-by-frame inventory + decoder gaps from 2,544 phase-5 frames.
- `coordination/research/audit-2026-05-06-android-repo.md` — cross-reference vs. Beyond+ Android app.

This file summarizes for SDK contributors and links to those audits.

## Contents

- [Setter validation matrix](#setter-validation-matrix)
- [Listener validation matrix](#listener-validation-matrix)
- [Decoded vs. undecoded frames](#decoded-vs-undecoded-frames)
- [Known issues](#known-issues)
- [In-flight work](#in-flight-work)

## Setter validation matrix

Per `audit-2026-05-06-untested-capabilities.md` Layer 1 + Layer 2.

### Validated end-to-end on-device

| Setter | Source | Validated |
|--------|--------|-----------|
| `setWeight` | `voltra-client.ts:380` | yes (long-standing) |
| `setChains` | `voltra-client.ts:401` | yes |
| `setEccentric` | `voltra-client.ts:449` | yes |
| `setInverseChains` | `voltra-client.ts:425` | yes |
| `setMode` (partial) | `voltra-client.ts:498` | Idle/WeightTraining/ResistanceBand/Damper/Isokinetic confirmed; Rowing/CustomCurves/Isometric NOT yet end-to-end validated |
| `setDamperLevel` | `voltra-client.ts:545` | yes (2026-05-06) — reflected in `settingsUpdate` |
| `setAssistMode` | `voltra-client.ts:575` | yes (2026-05-06) |
| `setBandMaxForce` | `voltra-client.ts:605` | yes (2026-05-06) — note: voltra-private generator still tagged `UNVALIDATED` (audit calls this stale) |
| `setIsokineticTargetSpeed` | `voltra-client.ts:638` | yes (2026-05-06) |
| `setIsokineticEccMode` | `voltra-client.ts:672` | yes (2026-05-06) |
| `setIsokineticEccSpeedLimit` | `voltra-client.ts:702` | yes (2026-05-06) |
| `setIsokineticEccConstWeight` | `voltra-client.ts:740` | yes (2026-05-06) — causes audible beep |
| `setIsokineticEccOverloadWeight` | `voltra-client.ts:778` | yes (2026-05-06) — causes audible beep |

### `@experimental` (protocol-validated, not on-device validated)

All four wrapped in 0.6.0 from voltra-private PR #11 register additions. No MCP wrapper yet.

| Setter | Source | Status |
|--------|--------|--------|
| `setTelemetryRate` | `voltra-client.ts:853` | UNVALIDATED end-to-end |
| `setTelemetrySubscribe` | `voltra-client.ts:884` | UNVALIDATED end-to-end |
| `setCableTrigger` | `voltra-client.ts:915` | UNVALIDATED end-to-end |
| `setResistanceExperience` | `voltra-client.ts:946` | UNVALIDATED end-to-end |

## Listener validation matrix

| Listener | Source | Validated |
|----------|--------|-----------|
| `onFrame` (telemetry stream) | `voltra-client.ts:1075` | yes — 1915 frames in phase-5 corpus |
| `onPerRep` | `voltra-client.ts:1105` | yes — 48 frames in corpus, all 5 typed fields decoded |
| `onSummary` | `voltra-client.ts:1122` | yes for weight schema (1); damper (3) and isokinetic (4) seen on-device but mode-specific aggregate fields at offset 18+ NOT decoded — consume `event.raw` |
| `onPreSummary` | `voltra-client.ts:1135` | yes — 6 frames; mode-specific aggregate fields beyond `repCount` / `repDurationMs` NOT decoded |
| `onInProgress` | `voltra-client.ts:1149` | yes — 68 frames, fires ~1 Hz throughout active set (NOT only end-of-set as earlier handoffs claimed); offsets validated empirically; `cfg.fieldsValidated === false` so offsets are hardcoded in `telemetry-decoder.ts:316-320` |
| `onModeConfirmed` | `voltra-client.ts:1161` | yes — 20 frames |
| `onSettingsUpdate` | `voltra-client.ts:1173` | yes — 48 frames; SDK maps 6 of 9 paramIds the device emits |
| `onBatteryUpdate` | `voltra-client.ts:1185` | yes (battery byte) |
| `onConnectionStateChange` | `voltra-client.ts:1086` | yes |

## Decoded vs. undecoded frames

Per `audit-2026-05-06-captures.md` frame inventory.

### Decoded

`telemetry_stream`, `vendor_per_rep`, `vendor_in_progress`, `vendor_summary` (universal fields only), `vendor_pre_summary` (universal fields only), `mode_confirmation`, `settings_update`, `multi_param`, `device_init`, `status_update` (battery only).

### Recognized but undecoded payload

| Frame | Notes |
|-------|-------|
| `vendor.summary` mode-specific fields (offset 18+, 121 B) | Per-schema field maps (weight/band/damper/isokinetic) not decoded; raw bytes available on `event.raw` |
| `vendor.preSummary` mode-specific fields | Same — only `repCount` + `repDurationMs` + `targetWeightTenths` decoded |
| `vendor.inProgress` bytes beyond the 4 hardcoded offsets | Many bytes still raw |
| `settings_update` paramIds: `workoutState 0x893e`, `0x0251`, `0xe14e`, `0x2451` | Observed every frame; not surfaced into `DeviceSettings` |
| `deviceName` (`55 2a 08 3f`) | 17 frames; device name + serial are extracted by adapter, not by SDK decoder |

### Unrecognized

Per `audit-2026-05-06-captures.md`:

- `0x55 0x17 0x04 0x38` (broadcastState, 23 B, sender `d2 ff`) — 68 frames in phase-5, no decoder.
- `0x55 0x18 0x04 0x20` (async-update for BLE-related registers) — 48 frames.
- `0x55 0x13 0x04 0x03` (single-param async update) — 29 frames; these are the device's "echo" responses to setter writes but the SDK reads the echoed value via the subsequent `settings_update`, not via these.
- `0x55 0x1b 0x04 0x75` (three-param async update for BLE conn params) — 17 frames.
- `0x55 0x10 0x04 0x56` (cmd `0x27` recurring status flag) — 17 frames.
- `0x55 0x0e 0x08 0xc5` (parameter-set ack frames) — 78 frames.

### Defined enums with no decoder

Per `audit-2026-05-06-untested-capabilities.md` Layer 1 section C:

- `VendorMessageType` sub-types: `RowingTelemetry (0x9525)`, `IsometricSummary (0x80)`, `IsometricWaveformChunk (0x93cc)`, `CustomCurveGraph (0x06)`, `RefreshTrigger (0x13)`, `CurveMetadataA (0x86)`, `CurveMetadataB (0x92)` — defined in protocol but never observed in any phase-5 capture.
- `CmdId` external research: `ExtAsyncParamUpdate`, `ExtSerialResponse`, `ExtDeviceNameSet`, `ExtFirmwareVersions`, `ExtBroadcastState`, etc. — enum'd, no decoder.
- `ExtParameterId` (7 registers): `RuntimePositionCm`, `CableOffsetCm`, `LogoApplyAction`, `BatteryRsoc`, `BleConnParam0/1/2` — kept in a separate enum to prevent the build pipeline from accidentally emitting setters until validated.

## Known issues

### `inProgress` velocity sign

`telemetry-decoder.ts:316-320` reads `velocityCmPerSec` as `uint16` but `protocol-reference.md` labels it `int16`. Worth a recheck against capture data — flagged in `audit-2026-05-06-captures.md` deep-dive #2.

### `damperLevel` paramId hardcoded

`telemetry-decoder.ts:38` hardcodes `'5103'` (paramId `0x0351` little-endian) for damperLevel reflection. Phase-5 Block F identified this as one of ~9 registers in the curated `settingsUpdate` subset but the regen has not yet promoted it into `protocol.telemetry.paramIds`. Cleanup is one regen sync away.

### `setIsokineticEccConstWeight` / `setIsokineticEccOverloadWeight` audible beep

The device emits an audible beep when these setters land. Possibly a safety/range cue from firmware. The command itself succeeds and the value applies. Documented in JSDoc on each method (`voltra-client.ts:733`, `:771`). No SDK fix possible — surface for consumers.

### `inProgress` cadence framing

Earlier 2026-05-06 handoffs claimed `inProgress` only fires at end-of-set. Phase-5 captures show it fires at ~1 Hz throughout the active set (28 events in 27 s observed). The "end-of-set only" framing came from MCP bridge filtering, not the SDK or wire protocol. SDK consumers using `onInProgress` directly will see continuous heartbeat. See `audit-2026-05-06-captures.md` TL;DR #1.

### Long file: voltra-client.ts (1433 lines)

Adding setters has bloated `voltra-client.ts`. Each setter is ~25 lines of boilerplate (validate → write → wrap-error). Extraction candidate: a `defineSetter(name, getCommand, getAvailable)` helper that compresses each setter to ~5 lines. No urgent need; flagged for future refactor.

## In-flight work

### 0.6.1 hotfix unpushed

Branch `fix/scan-adapter-reuse-node` has 2 commits:

```
c9b6293 chore: bump to 0.6.1
cddf7e0 fix: reuse scanAdapter on node platform for first connect after scan
```

Pre-0.6.1 the `scanAdapter` reuse path in `voltra-manager.ts` was gated to `platform === 'web'`, so on node a fresh adapter (with no `selectedDevice`) was built for every connect, and `NodeBLEAdapter.connect()` rejected immediately with "No device selected. Call scan() first." The fix removes the platform gate. Multi-device fan-out is preserved (a connect without a fresh scan still allocates a new adapter).

Awaiting tag push and OIDC publish.

### Phase 2 raw-signal work

Active integration plan: `coordination/integration-plans/raw-signal-architecture.md`. SDK has Phase 2 work in there — not yet started.

### MCP gaps (consumer-side, not SDK)

Out of scope for SDK but driving prioritization:

- Four `@experimental` setters not wrapped at MCP layer.
- `setInverseChains` is in SDK but not wrapped at MCP.
- `onModeConfirmed` and `onBatteryUpdate` are not bridged into MCP channel events.
- `onPerRep` payload is fully decoded by SDK but ignored by MCP bridge.
- `onSummary` payload partly used by MCP; `raw` 140-byte buffer (carrying mode-specific aggregate fields) is dropped.

These are SDK consumers' responsibility but flagged here for context. See `audit-2026-05-06-untested-capabilities.md` Layer 3.
