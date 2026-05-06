# Decode Pipeline

How a single BLE notification turns into a typed `VoltraClient` event.

## Contents

- [End-to-end trace](#end-to-end-trace)
- [Step 1 — adapter notify](#step-1--adapter-notify)
- [Step 2 — frame router (identifyMessageType)](#step-2--frame-router-identifymessagetype)
- [Step 3 — per-type decoder](#step-3--per-type-decoder)
- [Step 4 — DecodeResult to typed callback](#step-4--decoderesult-to-typed-callback)
- [Step 5 — VoltraClient event emission](#step-5--voltraclient-event-emission)
- [Vendor frame fast path](#vendor-frame-fast-path)
- [Failure modes](#failure-modes)

## End-to-end trace

```
Device
  │ BLE notification on NOTIFY_CHAR_UUID
  ▼
Adapter (Web | Node | Native | Mock)
  │ BaseBLEAdapter.emitNotification(Uint8Array)        bluetooth/adapters/base.ts:147
  ▼
NotificationCallback registered by VoltraClient
  │ createNotificationHandler(callbacks)               sdk/notification-dispatcher.ts:39
  ▼
decodeNotification(data) → DecodeResult                voltra/protocol/telemetry-decoder.ts:455
  │ identifyMessageType(data)                          voltra/protocol/telemetry-decoder.ts:121
  │   └─ matchesVendorSubType / 2-byte header match
  │ switch on MessageType → per-type decoder
  │   ├─ decodeTelemetryFrame                          :195
  │   ├─ decodeVendorPerRep / Summary / PreSummary / InProgress
  │   ├─ decodeModeConfirmation                        :347
  │   ├─ decodeSettingsUpdate                          :364
  │   └─ decodeDeviceStatus                            :418
  ▼
NotificationCallbacks (typed dispatch)                 sdk/notification-dispatcher.ts:44-80
  ▼
VoltraClient.setupNotificationHandler                  sdk/voltra-client.ts:1249
  │ for each event: this.emit(...) + listener-set fan-out
  ▼
Consumer callbacks (onFrame, onPerRep, onSummary, etc.)
```

## Step 1 — adapter notify

All `BLEAdapter` implementations call `this.emitNotification(bytes)` (`bluetooth/adapters/base.ts:147-155`) when the underlying BLE stack delivers a notification on the notify characteristic. Each registered `NotificationCallback` is invoked with the raw `Uint8Array`. Callbacks are added via `adapter.onNotification(cb)` (`base.ts:65-73`) and return an unsubscribe.

`VoltraClient` registers exactly one notification callback per connect (`voltra-client.ts:1288`).

## Step 2 — frame router (identifyMessageType)

`identifyMessageType(data)` (`voltra/protocol/telemetry-decoder.ts:121-163`) classifies a frame using two checks:

1. **4-byte header match** — only `MessageTypes.TELEMETRY_STREAM` is a stable 4-byte header today (`telemetry-decoder.ts:126`). Pre-0.6.0 the SDK also matched `REP_SUMMARY` / `SET_SUMMARY` / `STATUS_UPDATE` 4-byte signatures, but Phase A on-device validation (1369 frames, 2026-05-05) showed those were aliases for vendor sub-types or the 2-byte status notification. They were collapsed.

2. **Vendor sub-type match** — `matchesVendorSubType` (`constants/message-types.ts:53-61`) checks the cmd marker byte (`0xAA`) at `VendorMessages.cmdByteOffset` followed by 1-3 identifier bytes. Order of checks (`telemetry-decoder.ts:135-143`):
   - `VendorMessages.subTypes.perRep` → `'vendor_per_rep'`
   - `VendorMessages.subTypes.inProgress` → `'vendor_in_progress'`
   - `VendorMessages.subTypes.summary` → `'vendor_summary'`
   - `VendorMessages.subTypes.preSummary` → `'vendor_pre_summary'`

3. **2-byte header match** — for non-vendor non-stream frames (`telemetry-decoder.ts:146-160`):
   - `NotificationConfigs.modeConfirmation.header` → `'mode_confirmation'`
   - `NotificationConfigs.multiParam.header` → `'multi_param'`
   - `NotificationConfigs.settingsUpdate.header` → `'settings_update'`
   - `NotificationConfigs.deviceInit.header` → `'device_init'`
   - `NotificationConfigs.statusBattery.header` → `'status_update'`

Anything unmatched returns `'unknown'`.

`MessageType` string values (`telemetry-decoder.ts:104-115`): `'telemetry_stream' | 'vendor_per_rep' | 'vendor_in_progress' | 'vendor_summary' | 'vendor_pre_summary' | 'status_update' | 'mode_confirmation' | 'multi_param' | 'settings_update' | 'device_init' | 'unknown'`.

## Step 3 — per-type decoder

Each path has a dedicated decoder. All return either a typed `DecodeResult` variant or `null` on parse failure.

| MessageType | Decoder | Output |
|-------------|---------|--------|
| `telemetry_stream` | `decodeTelemetryFrame` `:195` | `{ type: 'frame', frame: TelemetryFrame }` |
| `vendor_per_rep` | `decodeVendorPerRep` `:245` | `{ type: 'perRep', event: PerRepEvent }` |
| `vendor_in_progress` | `decodeVendorInProgress` `:328` | `{ type: 'inProgress', event: InProgressEvent }` |
| `vendor_summary` | `decodeVendorSummary` `:274` | `{ type: 'summary', event: SummaryEvent }` |
| `vendor_pre_summary` | `decodeVendorPreSummary` `:293` | `{ type: 'preSummary', event: PreSummaryEvent }` |
| `mode_confirmation` | `decodeModeConfirmation` `:347` | `{ type: 'mode_confirmation', mode: TrainingMode }` |
| `settings_update` / `multi_param` | `decodeSettingsUpdate` `:364` | `{ type: 'settings_update', settings: DeviceSettings }` |
| `device_init` / `status_update` | `decodeDeviceStatus` `:418` | `{ type: 'device_status', battery: number }` |

### Telemetry stream

`decodeTelemetryFrame` (`telemetry-decoder.ts:195-220`) reads from `TelemetryOffsets`:

| Field | Offset | Type | Source |
|-------|--------|------|--------|
| sequence | `TelemetryOffsets.SEQUENCE` | uint16 LE | `telemetry-decoder.ts:201` |
| phase | `TelemetryOffsets.PHASE` | uint8 → `MovementPhase` enum (clamps invalid to `UNKNOWN`) | `telemetry-decoder.ts:204-210` |
| position | `TelemetryOffsets.POSITION` | uint16 LE | `telemetry-decoder.ts:215` |
| force | `TelemetryOffsets.FORCE` | uint16 LE (tenths of pounds) | `telemetry-decoder.ts:216` |
| velocity | `TelemetryOffsets.VELOCITY` | int16 LE (sign flips with direction) | `telemetry-decoder.ts:217` |

`createFrame` (`voltra/models/telemetry/frame.ts:31`) stamps `timestamp = Date.now()` at decode time.

### Vendor frames

All four vendor decoders pull field offsets from `cfg.fields` (a `VendorSubTypeConfig` from `protocol-data.generated.ts`) — no hardcoded byte positions, except for `inProgress` whose `fieldsValidated` is still `false` and whose offsets are hardcoded at `telemetry-decoder.ts:316-320`.

`frameOffsetOf(payloadOffset)` (`telemetry-decoder.ts:235-237`) resolves a payload-relative offset to an absolute frame offset: `cmdByteOffset + 1 + payloadOffset`.

| Decoder | Min length | Decoded fields | Source |
|---------|-----------|----------------|--------|
| `decodeVendorPerRep` | `cfg.frameLength` (74 B) | `phase ('pull'\|'return')`, `frameCounter`, `setCounter`, `repCount`, `targetWeightTenths` | `:245-266` |
| `decodeVendorSummary` | `cfg.frameLength` (140 B) | `schemaVersion`, `setCounter`, `repCount` (uint16 LE), `raw` | `:274-288` |
| `decodeVendorPreSummary` | `cfg.frameLength` (110 B) | `schemaVersion`, `targetWeightTenths`, `repCount` (uint16 LE), `repDurationMs` (uint32 LE), `raw` | `:293-311` |
| `decodeVendorInProgress` | 79 B | `peakForceTenths`, `currentForceTenths`, `velocityCmPerSec`, `targetWeightTenths` (uint32 LE), `raw` | `:328-341` |

Mode-specific aggregate fields beyond the universal ones are NOT decoded — consumers who need them read from `event.raw`. Each `schemaVersion` (1=weight, 2=band, 3=damper, 4=isokinetic) carries a different field map at frame offset 18+.

### Settings update

`decodeSettingsUpdate` (`telemetry-decoder.ts:364-412`) walks the param-list structure:

1. Reads `paramCount` at `config.paramCountOffset`.
2. Iterates up to 9 params from `config.firstParamOffset`.
3. For each param: reads 2-byte param ID, then either a 1-byte (uint8) or 2-byte (uint16 LE) value depending on whether the ID is in `Uint16ParamIds`.
4. Maps known IDs into `DeviceSettings`: `BASE_WEIGHT`, `CHAINS`, `ECCENTRIC`, `TRAINING_MODE`, `INVERSE_CHAINS`, and the `damperLevel` paramId (hardcoded to `'5103'` at `:38` pending regen sync).

Note: phase-5 captures show the device emits 9 paramIds per frame; the SDK only maps 6 of them. The other 3 (`workoutState 0x893e`, `0x0251`, `0xe14e`, `0x2451`) are observed but not surfaced — see `coordination/research/audit-2026-05-06-captures.md`.

### Device status / battery

`decodeDeviceStatus` (`telemetry-decoder.ts:418-449`) tries both the `deviceInit` and `statusBattery` formats, reading battery at `config.batteryOffset`. Falls through to `{ type: 'unknown', data }` if neither header matches.

## Step 4 — DecodeResult to typed callback

`createNotificationHandler(callbacks)` (`sdk/notification-dispatcher.ts:39-82`) is the seam between the pure decoder and the stateful client. It calls `decodeNotification(data)` and switches on `result.type`:

```
'frame'              → callbacks.onFrame(result.frame)
'perRep'             → callbacks.onPerRep(result.event)
'inProgress'         → callbacks.onInProgress(result.event)
'summary'            → callbacks.onSummary(result.event)
'preSummary'         → callbacks.onPreSummary(result.event)
'mode_confirmation'  → callbacks.onModeConfirmed(result.mode)
'settings_update'    → callbacks.onSettingsUpdate(result.settings)
'device_status'      → callbacks.onBatteryUpdate(result.battery)
'unknown'            → silently dropped
```

This module is pure — no `this`, no state, no error handling beyond what the decoder provides. Its only responsibility is the switch.

## Step 5 — VoltraClient event emission

`VoltraClient.setupNotificationHandler` (`sdk/voltra-client.ts:1249-1289`) constructs the `NotificationCallbacks` object. For each event type it does two things:

1. `this.emit({ type: 'X', ... })` — adds to the unified `VoltraClientEvent` stream (`voltra-client.ts:1361-1369`), feeding all `subscribe()` listeners.
2. `this.XListeners.forEach(l => l(payload))` — fans out to the type-specific listener set (`onFrame`, `onPerRep`, etc.).

Settings updates also trigger `syncSettingsFromDevice(settings)` (`voltra-client.ts:1413-1432`) which mutates `this._settings` from the device-reported truth — that's how `client.settings` reflects device-side reality after a setter write.

## Vendor frame fast path

For consumers wanting to decode without instantiating a `VoltraClient` (e.g. capture replay tooling), the four pure decoders are exported from the package root:

```ts
import {
  decodeVendorPerRep,
  decodeVendorSummary,
  decodeVendorPreSummary,
  decodeVendorInProgress,
} from '@voltras/node-sdk';
```

They return `null` on sub-type mismatch or short buffer. See `public-api.md`.

## Failure modes

| Scenario | Behavior | Source |
|----------|----------|--------|
| Unknown 4-byte/2-byte header | `identifyMessageType` returns `'unknown'`; `decodeNotification` returns `{ type: 'unknown', data }`; `createNotificationHandler` silently drops | `telemetry-decoder.ts:498-499`, `notification-dispatcher.ts:77` |
| Vendor frame with truncation/sub-type mismatch | Pure decoder returns `null`; `decodeNotification` collapses to `{ type: 'unknown', data }`. (Pre-0.6.0 these downgraded to `'rep_boundary'` / `'set_boundary'` payload-less variants — removed.) | `telemetry-decoder.ts:464-485` |
| Telemetry frame shorter than 30 B | `decodeTelemetryFrame` returns `null`; `decodeNotification` returns `null` | `telemetry-decoder.ts:196-198` |
| Phase byte outside 0-3 | Coerced to `MovementPhase.UNKNOWN` (-1) | `telemetry-decoder.ts:204-210` |
| Mode confirmation with unknown mode value | Coerced to `TrainingMode.Idle` | `telemetry-decoder.ts:353-356` |
| Listener throws | `this.emit` catches and `console.error`s; other listeners still run | `voltra-client.ts:1361-1369`, `base.ts:131-138`,`base.ts:148-154` |
