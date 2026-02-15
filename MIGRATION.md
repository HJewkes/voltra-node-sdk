# Migration Guide

Breaking changes and migration steps for consumers upgrading to the latest version of `@voltras/node-sdk`.

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
