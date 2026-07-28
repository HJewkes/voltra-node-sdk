# Migration Guide

Breaking changes and migration steps for consumers upgrading to the latest version of `@voltras/node-sdk`.

## Migrating to 0.12.0

No API signatures changed. Three behavioral changes may affect you.

### Device name filtering is off by default

Scans previously kept only devices whose advertised name started with `VTR-`,
hardcoded with no override — so a Voltra renamed in the vendor app was
silently undiscoverable. Devices are now identified by advertised BLE service
UUID, and name filtering is opt-in:

```typescript
new VoltraManager({ deviceNamePrefix: VOLTRA_DEVICE_PREFIX }) // manager-level
manager.scan({ deviceNamePrefix: 'VTR-' })                    // per-scan
VOLTRA_DEVICE_NAME_PREFIX=VTR-                                // env var (Node)
```

`null` or `''` disables filtering explicitly. **Action:** if you relied on
scan results being name-filtered, pass a prefix. Most consumers should not —
the advertised name is user-editable and a poor identity signal.

### Node auto-detection now selects `node-noble`

`new VoltraManager()` in Node resolves to `'node-noble'` instead of `'node'`.
The noble backend enumerates correctly and is multi-peripheral-safe.

The legacy backend is a picker, not a scanner: `webbluetooth`'s
`requestDevice` selects the first device passing the filter and stops, so
`scan()` can never return more than one device, and without a name filter it
returns whatever advertises first. That is why it alone keeps the `VTR-`
prefix on by default.

**Action:** none for most consumers. `VoltraManager.forNode()` still selects
the legacy backend explicitly if you need it. Requires `@stoprocent/noble`,
already an optional dependency.

### Browser consumers get a dedicated entry

The package root previously could not be bundled for a browser at all. The
`browser` export condition now resolves to a Web-Bluetooth-only entry with no
Node dependencies, so `import { VoltraManager } from '@voltras/node-sdk'`
works unchanged in Vite/webpack/Rollup. In that entry `VoltraManager` aliases
`VoltraWebManager` and does not carry `forNode()` / `forNative()` /
`forNodeNoble()`.

**Action:** none if your bundler applies the `browser` condition. Otherwise
import `@voltras/node-sdk/web` directly.

## Migrating from 0.5.x to 0.6.0

### `onRepBoundary` removed — use `onPerRep` instead

The payload-less `onRepBoundary` listener has been removed. The replacement
`onPerRep` callback receives a typed event payload with motion phase, frame
counter, set counter, rep count, and target weight.

**Before (0.5.x):**

```typescript
client.onRepBoundary(() => {
  repCount++;
  playRepSound();
});
```

**After (0.6.0):**

```typescript
client.onPerRep((event) => {
  // event.phase: 'pull' | 'return'
  // event.repCount, event.setCounter, event.frameCounter, event.targetWeightTenths
  if (event.phase === 'pull') {
    repCount++;
    playRepSound();
  }
});
```

`onPerRep` fires twice per rep (pull start + return start). Filter on
`event.phase === 'pull'` if you only want a single per-rep edge.

---

### `onSetBoundary` removed — use `onInProgress` instead

The payload-less `onSetBoundary` listener has been removed. The replacement
`onInProgress` callback fires on the vendor `inProgress` heartbeat (~1 Hz)
and carries a typed payload with peak/current force, velocity, and target
weight.

**Before (0.5.x):**

```typescript
client.onSetBoundary(() => {
  logHeartbeat();
});
```

**After (0.6.0):**

```typescript
client.onInProgress((event) => {
  // event.peakForceTenths, event.currentForceTenths,
  // event.velocityCmPerSec, event.targetWeightTenths, event.raw
  logHeartbeat(event.peakForceTenths);
});
```

**Throttling note:** `onInProgress` fires at the same ~1 Hz rate as the legacy
`onSetBoundary`. If you only care about the first beat, gate on a flag in your
own state. Latency-sensitive code paths should prefer `onSummary` / `onPerRep`.

---

### `'repBoundary'` / `'setBoundary'` variants removed from `VoltraClientEvent`

If you used the unified `client.subscribe()` event listener, the
`'repBoundary'` and `'setBoundary'` variants no longer exist on the
discriminated union. Replace them with `'perRep'` and `'inProgress'`:

```typescript
client.subscribe((event) => {
  switch (event.type) {
    case 'perRep':
      // event.event: PerRepEvent
      break;
    case 'inProgress':
      // event.event: InProgressEvent
      break;
    case 'summary':
      // event.event: SummaryEvent
      break;
    case 'preSummary':
      // event.event: PreSummaryEvent
      break;
    // ... other variants unchanged
  }
});
```

---

### `MessageType` string rename

`identifyMessageType()` (low-level decoder API) returns renamed strings for
the vendor sub-type frames. Only matters if you call `identifyMessageType()`
or pattern-match on `DecodeResult.type` directly:

| 0.5.x                                   | 0.6.0                       |
| --------------------------------------- | --------------------------- |
| `'rep_summary'`                         | `'vendor_per_rep'`          |
| `'set_summary'`                         | `'vendor_in_progress'`      |
| (didn't exist)                          | `'vendor_summary'`          |
| (didn't exist)                          | `'vendor_pre_summary'`      |
| `DecodeResult` `'rep_boundary'` variant | merged into `'unknown'`     |
| `DecodeResult` `'set_boundary'` variant | merged into `'unknown'`     |

The high-level `VoltraClient` API never surfaced these strings, so most
consumers can ignore this change.

---

### New imports for typed vendor events

```typescript
import {
  VendorMessages,
  VendorSchemaVersion,
  decodeVendorPerRep,
  decodeVendorSummary,
  decodeVendorPreSummary,
  decodeVendorInProgress,
  type PerRepEvent,
  type SummaryEvent,
  type PreSummaryEvent,
  type InProgressEvent,
} from '@voltras/node-sdk';
```

---

## Breaking Changes

### `VoltraDevice` class removed from public exports

The `VoltraDevice` class is no longer exported. Use `VoltraClient` (obtained via `VoltraManager.connect()`) to interact with devices.

**Before:**

```typescript
import { VoltraDevice } from '@voltras/node-sdk';

const device = new VoltraDevice('device-id', 'VTR-123');
```

**After:**

```typescript
import { VoltraManager } from '@voltras/node-sdk';

const manager = new VoltraManager();
const devices = await manager.scan();
const client = await manager.connect(devices[0]);
```

The types `VoltraDeviceSettings`, `VoltraRecordingState`, and `VoltraDeviceState` are still available as type-only exports.

---

### `DEFAULT_SETTINGS` removed from public exports

`DEFAULT_SETTINGS` is no longer exported. Use `client.settings` to access the current device settings after connecting.

**Before:**

```typescript
import { DEFAULT_SETTINGS } from '@voltras/node-sdk';
const settings = { ...DEFAULT_SETTINGS };
```

**After:**

```typescript
// Read settings from the connected client
const settings = client.settings;
// { weight: 0, chains: 0, inverseChains: 0, eccentric: 0, mode: TrainingMode.Idle, battery: null }
```

---

### `DeviceSettings.trainingMode` type changed from `number` to `TrainingMode`

The `trainingMode` field in `DeviceSettings` (received via `onSettingsUpdate`) is now typed as `TrainingMode` instead of `number`.

**Before:**

```typescript
client.onSettingsUpdate((settings) => {
  if (settings.trainingMode === 1) { // raw number comparison
    console.log('Weight training mode');
  }
});
```

**After:**

```typescript
import { TrainingMode } from '@voltras/node-sdk';

client.onSettingsUpdate((settings) => {
  if (settings.trainingMode === TrainingMode.WeightTraining) {
    console.log('Weight training mode');
  }
});
```

---

### `DecodeResult` `mode_confirmation` mode field changed from `number` to `TrainingMode`

If you use the low-level `decodeNotification()` API directly, the `mode` field on `mode_confirmation` results is now `TrainingMode` instead of `number`.

**Before:**

```typescript
const result = decodeNotification(data);
if (result?.type === 'mode_confirmation') {
  const mode: number = result.mode;
}
```

**After:**

```typescript
const result = decodeNotification(data);
if (result?.type === 'mode_confirmation') {
  const mode: TrainingMode = result.mode; // Now strongly typed
}
```

---

## Non-Breaking Changes

These changes are backward-compatible and require no consumer updates:

- **Constants reorganized**: `constants.ts` split into focused files under `constants/`. All existing import paths (`from '@voltras/node-sdk'`) continue to work unchanged.
- **Client internals extracted**: Notification handling and reconnect logic moved to separate modules. The `VoltraClient` public API is unchanged.
- **Duplicate code removed**: Internal deduplication of `bytesToHex` and redundant assignments. No API impact.
- **New tests added**: 93 new tests covering commands, connection state machine, device filtering, error types, and telemetry frame helpers.
- **README updated**: Fixed telemetry rate documentation (~11 Hz, not ~100 Hz), added inverse chains documentation, corrected property names and type descriptions.
- **Protocol documentation restored**: `docs/concepts/bluetooth-protocol.md` provides a high-level BLE communication overview.
