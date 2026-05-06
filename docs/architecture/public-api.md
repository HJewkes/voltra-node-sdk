# Public API Surface

Every export consumers can reach via `import { ... } from '@voltras/node-sdk'` or `@voltras/node-sdk/react`. Source-of-truth: `src/index.ts`.

## Contents

- [VoltraManager methods](#voltramanager-methods)
- [VoltraManager events](#voltramanager-events)
- [VoltraClient methods](#voltraclient-methods)
- [VoltraClient listeners](#voltraclient-listeners)
- [VoltraClient events (unified subscribe)](#voltraclient-events-unified-subscribe)
- [VoltraClient state getters](#voltraclient-state-getters)
- [Decoder entry points](#decoder-entry-points)
- [Adapters](#adapters)
- [Errors](#errors)
- [Constants and enums](#constants-and-enums)
- [Types](#types)
- [/react subpath](#react-subpath)
- [Subpath-only value exports](#subpath-only-value-exports)

## VoltraManager methods

Source: `src/sdk/voltra-manager.ts`.

### Static factories

| Method | Returns | Source |
|--------|---------|--------|
| `new VoltraManager(opts?)` | `VoltraManager` | `voltra-manager.ts:124` |
| `VoltraManager.forWeb(opts?)` | `VoltraManager` | `voltra-manager.ts:149` |
| `VoltraManager.forNode(opts?)` | `VoltraManager` | `voltra-manager.ts:156` |
| `VoltraManager.forNative(opts?)` | `VoltraManager` | `voltra-manager.ts:164` |
| `VoltraManager.forMock(config?)` | `VoltraManager` | `voltra-manager.ts:172` |

### Instance methods

| Method | Purpose | Source |
|--------|---------|--------|
| `scan(options?)` | Scan for devices, returns `DiscoveredDevice[]` | `voltra-manager.ts:254` |
| `connect(device)` | Connect, returns `VoltraClient` | `voltra-manager.ts:288` |
| `connectByName(namePattern, opts?)` | Scan + connect by name match (exact/contains/startsWith) | `voltra-manager.ts:365` |
| `connectFirst(opts?)` | Scan + connect to first available | `voltra-manager.ts:409` |
| `disconnect(deviceId)` | Disconnect specific device | `voltra-manager.ts:422` |
| `disconnectAll()` | Disconnect all clients | `voltra-manager.ts:440` |
| `getClient(deviceId)` | Lookup connected `VoltraClient` | `voltra-manager.ts:226` |
| `getAllClients()` | All connected `VoltraClient[]` | `voltra-manager.ts:233` |
| `isConnected(deviceId)` | Boolean | `voltra-manager.ts:240` |
| `getAdapter()` | Current `BLEAdapter` (debug access) | `voltra-manager.ts:215` |
| `subscribe(listener)` | Subscribe to manager events | `voltra-manager.ts:452` |
| `onDeviceConnected(cb)` | Convenience — only `deviceConnected` events | `voltra-manager.ts:460` |
| `onDeviceDisconnected(cb)` | Convenience — only `deviceDisconnected` events | `voltra-manager.ts:475` |
| `dispose()` | Disconnect all + clear listeners | `voltra-manager.ts:492` |

### Instance getters

| Getter | Type | Source |
|--------|------|--------|
| `connectedDeviceIds` | `string[]` | `voltra-manager.ts:186` |
| `connectedCount` | `number` | `voltra-manager.ts:193` |
| `isScanning` | `boolean` | `voltra-manager.ts:200` |
| `devices` | `DiscoveredDevice[]` (last scan) | `voltra-manager.ts:207` |

## VoltraManager events

`VoltraManagerEvent` discriminated union (`voltra-manager.ts:87-92`):

| `type` | Payload |
|--------|---------|
| `deviceConnected` | `deviceId, deviceName, client` |
| `deviceDisconnected` | `deviceId` |
| `deviceError` | `deviceId, error` |
| `scanStarted` | — |
| `scanStopped` | `devices` |

## VoltraClient methods

Source: `src/sdk/voltra-client.ts`.

### Lifecycle

| Method | Purpose | Source |
|--------|---------|--------|
| `connect(device)` | BLE connect + auth + init | `voltra-client.ts:298` |
| `disconnect()` | Stop recording + disconnect | `voltra-client.ts:348` |
| `dispose()` | Tear down all listeners | `voltra-client.ts:1198` |
| `setAdapter(a)` | Replace adapter (when not connected) | `voltra-client.ts:250` |
| `getAdapter()` | Current `BLEAdapter` or null | `voltra-client.ts:261` |
| `scan(options?)` | Scan via the client's adapter (lower-level than `manager.scan`) | `voltra-client.ts:278` |

### Core resistance setters

| Method | Range | Source |
|--------|-------|--------|
| `setWeight(lbs)` | 5–200 (any int) | `voltra-client.ts:380` |
| `setChains(lbs)` | 0–100 | `voltra-client.ts:401` |
| `setInverseChains(lbs)` | 0–100 | `voltra-client.ts:425` |
| `setEccentric(percent)` | -195 to +195 | `voltra-client.ts:449` |
| `setMode(TrainingMode)` | enum | `voltra-client.ts:498` |

### Mode-config setters (0.6.0)

| Method | Range / values | Source |
|--------|----------------|--------|
| `setDamperLevel(0..9)` | UI displays N+1 | `voltra-client.ts:545` |
| `setAssistMode('off' \| 'on')` | — | `voltra-client.ts:575` |
| `setBandMaxForce(15..70)` | lbs | `voltra-client.ts:605` |
| `setIsokineticTargetSpeed(mmPerSec)` | 0–2000, step 10 | `voltra-client.ts:638` |
| `setIsokineticEccMode('isokinetic' \| 'constant')` | — | `voltra-client.ts:672` |
| `setIsokineticEccSpeedLimit(mmPerSec)` | 0 = auto | `voltra-client.ts:702` |
| `setIsokineticEccConstWeight(lbs)` | 0–200 (audible beep) | `voltra-client.ts:740` |
| `setIsokineticEccOverloadWeight(lbs)` | 0–200 (audible beep) | `voltra-client.ts:778` |

### Experimental QoL setters (0.6.0)

`@experimental` — protocol-validated but not yet on-device validated. See `status.md`.

| Method | Source |
|--------|--------|
| `setTelemetryRate(hz)` | `voltra-client.ts:853` |
| `setTelemetrySubscribe('none' \| 'all')` | `voltra-client.ts:884` |
| `setCableTrigger('open' \| 'close')` | `voltra-client.ts:915` |
| `setResistanceExperience('intense' \| 'standard')` | `voltra-client.ts:946` |

### Available-value introspection

Each setter has a paired `getAvailableX(): number[]` (or string union):

| Method | Source |
|--------|--------|
| `getAvailableWeights()` | `voltra-client.ts:468` |
| `getAvailableChains()` | `voltra-client.ts:475` |
| `getAvailableEccentric()` | `voltra-client.ts:482` |
| `getAvailableInverseChains()` | `voltra-client.ts:489` |
| `getAvailableModes()` | `voltra-client.ts:516` |
| `getAvailableDamperLevels()` | `voltra-client.ts:801` |
| `getAvailableBandMaxForce()` | `voltra-client.ts:806` |
| `getAvailableIsokineticTargetSpeeds()` | `voltra-client.ts:811` |
| `getAvailableIsokineticEccSpeedLimits()` | `voltra-client.ts:816` |
| `getAvailableIsokineticEccConstWeights()` | `voltra-client.ts:821` |
| `getAvailableIsokineticEccOverloadWeights()` | `voltra-client.ts:826` |
| `getAvailableTelemetryRates()` (`@experimental`) | `voltra-client.ts:965` |

### Recording lifecycle

| Method | State transition | Source |
|--------|------------------|--------|
| `prepareRecording()` | `idle → preparing → ready` | `voltra-client.ts:977` |
| `startRecording()` | `(prepares if needed) → active` | `voltra-client.ts:999` |
| `stopRecording()` | `* → stopping → idle` | `voltra-client.ts:1018` |
| `endSet()` | `active → ready` (stay prepared) | `voltra-client.ts:1040` |

`VoltraRecordingState` = `'idle' \| 'preparing' \| 'ready' \| 'active' \| 'stopping'` (`voltra/models/device.ts:40`).

## VoltraClient listeners

Convenience subscribers — each returns an unsubscribe function. Source: `src/sdk/voltra-client.ts`.

| Method | Payload type | Cadence | Source |
|--------|--------------|---------|--------|
| `onFrame(cb)` | `TelemetryFrame` | ~11 Hz during active recording | `voltra-client.ts:1075` |
| `onPerRep(cb)` | `PerRepEvent` | 2× per rep (pull start, return start) | `voltra-client.ts:1105` |
| `onSummary(cb)` | `SummaryEvent` | once at end-of-set | `voltra-client.ts:1122` |
| `onPreSummary(cb)` | `PreSummaryEvent` | once, ~3 s before final rep | `voltra-client.ts:1135` |
| `onInProgress(cb)` | `InProgressEvent` | ~1 Hz throughout active set (NOT only at end — see `status.md`) | `voltra-client.ts:1149` |
| `onModeConfirmed(cb)` | `TrainingMode` | on mode change | `voltra-client.ts:1161` |
| `onSettingsUpdate(cb)` | `DeviceSettings` (partial) | on setter writes + connect/go/stop | `voltra-client.ts:1173` |
| `onBatteryUpdate(cb)` | `number` | periodic device pushes | `voltra-client.ts:1185` |
| `onConnectionStateChange(cb)` | `VoltraConnectionState` | on transition | `voltra-client.ts:1086` |
| `subscribe(cb)` | `VoltraClientEvent` (full union) | all events | `voltra-client.ts:1063` |

## VoltraClient events (unified subscribe)

`VoltraClientEvent` discriminated union (`src/sdk/types.ts:68-88`):

| `type` | Payload |
|--------|---------|
| `connectionStateChanged` | `state: VoltraConnectionState` |
| `connected` | `deviceId, deviceName` |
| `disconnected` | `deviceId` |
| `reconnecting` | `attempt, maxAttempts` |
| `recordingStateChanged` | `state: VoltraRecordingState` |
| `frame` | `frame: TelemetryFrame` |
| `perRep` | `event: PerRepEvent` |
| `summary` | `event: SummaryEvent` |
| `preSummary` | `event: PreSummaryEvent` |
| `inProgress` | `event: InProgressEvent` |
| `modeConfirmed` | `mode: TrainingMode` |
| `settingsUpdate` | `settings: DeviceSettings` |
| `batteryUpdate` | `battery: number` |
| `error` | `error: Error` |

## VoltraClient state getters

| Getter | Type | Source |
|--------|------|--------|
| `connectionState` | `VoltraConnectionState` | `voltra-client.ts:165` |
| `isConnected` | `boolean` | `voltra-client.ts:172` |
| `isReconnecting` | `boolean` | `voltra-client.ts:179` |
| `connectedDeviceId` | `string \| null` | `voltra-client.ts:186` |
| `connectedDeviceName` | `string \| null` | `voltra-client.ts:193` |
| `settings` | `VoltraDeviceSettings` | `voltra-client.ts:200` |
| `recordingState` | `VoltraRecordingState` | `voltra-client.ts:207` |
| `isRecording` | `boolean` | `voltra-client.ts:214` |
| `error` | `Error \| null` | `voltra-client.ts:221` |
| `state` | `VoltraClientState` (full snapshot) | `voltra-client.ts:228` |

## Decoder entry points

Pure functions — no adapter required. Useful for capture-replay and tests.

| Export | Source |
|--------|--------|
| `decodeTelemetryFrame(data)` | `telemetry-decoder.ts:195` |
| `decodeNotification(data)` | `telemetry-decoder.ts:455` |
| `encodeTelemetryFrame(frame)` | `telemetry-decoder.ts:512` |
| `identifyMessageType(data)` | `telemetry-decoder.ts:121` |
| `decodeVendorPerRep(data)` | `telemetry-decoder.ts:245` |
| `decodeVendorSummary(data)` | `telemetry-decoder.ts:274` |
| `decodeVendorPreSummary(data)` | `telemetry-decoder.ts:293` |
| `decodeVendorInProgress(data)` | `telemetry-decoder.ts:328` |
| `matchesVendorSubType(data, cfg)` | `constants/message-types.ts:53` |

## Adapters

Type-only at root, value at subpath. See `adapters.md` for runtime selection.

| Class | Root export | Subpath value | Source |
|-------|-------------|---------------|--------|
| `WebBLEAdapter` | type-only | `@voltras/node-sdk/web` | `bluetooth/adapters/web.ts` |
| `NodeBLEAdapter` | type-only | `@voltras/node-sdk/node` | `bluetooth/adapters/node.ts` |
| `NativeBLEAdapter` | type-only | `@voltras/node-sdk/native` | `bluetooth/adapters/native.ts` |
| `MockBLEAdapter` | **value** | (root) | `bluetooth/adapters/mock.ts` |

`createBLEAdapter(config)` factory: `bluetooth/adapters/index.ts:86` — auto-detects web vs. node only.

`MockBLEAdapter` ships with scenario factories: `createMultiSetScenario`, `createPauseSetScenario`, `createTempoScenario`, `createShortRestScenario` (all from `mock/session-config.ts`).

## Errors

All extend `VoltraSDKError`. Source: `src/errors.ts`.

| Class | Code | Source |
|-------|------|--------|
| `VoltraSDKError` | base | `errors.ts:68` |
| `ConnectionError` | `CONNECTION_FAILED` (default) | `errors.ts:88` |
| `AuthenticationError` | `AUTH_FAILED` | `errors.ts:99` |
| `TimeoutError` | `TIMEOUT` (carries `timeoutMs`) | `errors.ts:109` |
| `NotConnectedError` | `NOT_CONNECTED` | `errors.ts:122` |
| `InvalidSettingError` | `INVALID_SETTING` (carries `setting`, `value`, `validValues`) | `errors.ts:133` |
| `BluetoothUnavailableError` | `BLUETOOTH_UNAVAILABLE` | `errors.ts:153` |
| `CommandError` | `COMMAND_FAILED` | `errors.ts:169` |
| `TelemetryError` | `TELEMETRY_DECODE_ERROR` | `errors.ts:182` |

`ErrorCode` enum: `errors.ts:27-60`.

## Constants and enums

| Export | Source |
|--------|--------|
| `MovementPhase` | `constants/enums.ts:16` |
| `PhaseNames` | `constants/enums.ts:27` |
| `TrainingMode` | `constants/enums.ts:75` |
| `TrainingModeNames` | `constants/enums.ts:97` |
| `VALID_TRAINING_MODES` | `constants/enums.ts:111` |
| `ParameterId` | `constants/enums.ts:43` |
| `ParameterNames` | `constants/enums.ts:59` |
| `VendorSchemaVersion` | `constants/enums.ts:131` |
| `MessageTypes.TELEMETRY_STREAM` | `constants/message-types.ts:27` |
| `VendorMessages` | `constants/message-types.ts:43` |
| `TelemetryOffsets` | `constants/message-types.ts:70` |
| `BLE` (UUIDs + name prefix) | `constants/ble-config.ts:12` |
| `Timing` | `constants/timing.ts:7` |
| `Auth` (DEVICE_ID) | `constants/connection-commands.ts:20` |
| `Init` (init sequence) | `constants/connection-commands.ts:34` |
| `Workout` (PREPARE/SETUP/GO/STOP) | `constants/connection-commands.ts:48` |
| `VOLTRA_DEVICE_PREFIX` | `voltra/models/device-filter.ts:13` |

Command-builder utilities (one per setter) — see `commands.ts:59-413` and the table in [VoltraClient methods](#voltraclient-methods).

Utility: `getDeviceDisplayName`, `sortBySignalStrength` (`bluetooth/models/device.ts:22-35`), `isVoltraDevice`, `filterVoltraDevices` (`voltra/models/device-filter.ts:18-27`), `delay` (`shared/utils.ts`), `setDebugEnabled` (`shared/logger.ts`).

## Types

| Type | Source |
|------|--------|
| `Platform` (`'web' \| 'node' \| 'native' \| 'mock'`) | `voltra-manager.ts:42` |
| `VoltraManagerOptions` | `voltra-manager.ts:52` |
| `VoltraManagerEvent` | `voltra-manager.ts:87` |
| `VoltraManagerEventListener` | `voltra-manager.ts:97` |
| `ConnectByNameOptions` | `voltra-manager.ts:74` |
| `AdapterFactory` | `voltra-manager.ts:47` |
| `VoltraClientOptions` | `sdk/types.ts:18` |
| `VoltraClientState` | `sdk/types.ts:217` |
| `VoltraClientEvent` | `sdk/types.ts:68` |
| `VoltraClientEventListener` | `sdk/types.ts:93` |
| `ScanOptions` | `sdk/types.ts:47` |
| `FrameListener` | `sdk/types.ts:98` |
| `PerRepEvent` / `SummaryEvent` / `PreSummaryEvent` / `InProgressEvent` | `sdk/types.ts:128-200` |
| `PerRepListener` / `SummaryListener` / `PreSummaryListener` / `InProgressListener` | `sdk/types.ts:202-212` |
| `VoltraDeviceSettings` | `voltra/models/device.ts:13` |
| `VoltraRecordingState` | `voltra/models/device.ts:40` |
| `VoltraDeviceState` | `voltra/models/device.ts:45` |
| `VoltraConnectionState` | `voltra/models/connection.ts:10` |
| `TelemetryFrame` | `voltra/models/telemetry/frame.ts:13` |
| `DeviceSettings` (decoder output) | `voltra/protocol/types.ts:365` |
| `DiscoveredDevice` | `bluetooth/models/device.ts:10` |
| `BLEAdapter` | `bluetooth/adapters/types.ts:67` |
| `BLEServiceConfig` | `bluetooth/adapters/types.ts:47` |
| `ConnectOptions` | `bluetooth/adapters/types.ts:35` |
| `ConnectionState` | `bluetooth/adapters/types.ts:20` |
| `NotificationCallback` / `ConnectionStateCallback` | `bluetooth/adapters/types.ts:25-30` |
| `MockBLEConfig` / `MockSessionConfig` / `PlannedRepProfile` | `bluetooth/adapters/mock/types.ts` |
| `DecodeResult` / `MessageType` | `voltra/protocol/telemetry-decoder.ts:104,176` |

## /react subpath

Source: `src/react/hooks.ts`. Import from `@voltras/node-sdk/react`.

| Export | Returns | Source |
|--------|---------|--------|
| `useVoltraScanner(manager)` | `VoltraScannerState` (devices, isScanning, error, scan, clear) | `hooks.ts:81` |
| `useVoltraDevice(client)` | `VoltraDeviceState` (connectionState, recordingState, settings, currentFrame, error, …) | `hooks.ts:177` |
| `useVoltra(manager)` | `UseVoltraState` (combined scanner + device + connect/disconnect + setter shortcuts) | `hooks.ts:279` |
| Type `VoltraScannerState` | — | `hooks.ts:62` |
| Type `VoltraDeviceState` | — | `hooks.ts:144` |
| Type `UseVoltraState` | — | `hooks.ts:251` |

`useVoltraDevice` only mirrors a subset of events (state changes, recording state, frames, errors). For `perRep`/`summary`/etc. consumers, subscribe directly via `client.onPerRep` etc.

## Subpath-only value exports

The platform-adapter subpaths (`./web`, `./node`, `./native`) re-export the adapter class as a value. Use these when you want to instantiate an adapter directly (e.g. `new NativeBLEAdapter({ ble: BLE })`) without going through `VoltraManager`.

```ts
// Type-only (root)
import type { NativeBLEAdapter } from '@voltras/node-sdk';

// Value (subpath)
import { NativeBLEAdapter } from '@voltras/node-sdk/native';
```

The `package.json:30-58` exports map enforces this split — see `overview.md` for why.
