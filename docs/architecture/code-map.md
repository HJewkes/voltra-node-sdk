# Code Map

File-by-file responsibility map for `src/`. Citations are `path:line` so a reader can jump directly to the symbol.

## Contents

- [Top-level](#top-level)
- [src/sdk/ — high-level API](#srcsdk--high-level-api)
- [src/voltra/ — protocol + models](#srcvoltra--protocol--models)
- [src/bluetooth/ — adapter abstraction](#srcbluetooth--adapter-abstraction)
- [src/react/ — react subpath](#srcreact--react-subpath)
- [src/shared/ — utilities](#srcshared--utilities)
- [src/types/ — ambient declarations](#srctypes--ambient-declarations)
- [Tests layout](#tests-layout)

## Top-level

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 229 | Public API barrel. Exports `VoltraManager`, `VoltraClient`, error classes, decoder entry points, type-only adapter classes, MockBLEAdapter as a value. Sections marked with `// =====` banners. |
| `src/errors.ts` | 187 | Typed error hierarchy: `VoltraSDKError` (base), `ConnectionError`, `AuthenticationError`, `TimeoutError`, `NotConnectedError`, `InvalidSettingError`, `BluetoothUnavailableError`, `CommandError`, `TelemetryError`. `ErrorCode` enum at `errors.ts:27-60`. |

## src/sdk/ — high-level API

| File | Lines | Purpose |
|------|-------|---------|
| `src/sdk/index.ts` | 42 | Barrel re-exporting `VoltraClient`, `VoltraManager`, all client/manager event types. |
| `src/sdk/voltra-manager.ts` | 610 | `VoltraManager` class. Owns adapter factory selection (`createAdapterFactory` at `voltra-manager.ts:526-571`), platform auto-detection (`detectPlatform` at `:506-524`), per-client BLE adapter allocation (`connect` at `:288-345`), scan adapter reuse (`:307-313`), connect-by-name and connect-first conveniences. |
| `src/sdk/voltra-client.ts` | 1433 | `VoltraClient` class. Public setter API (`:380-967`), recording lifecycle (`:977-1051`), event subscription (`:1063-1188`), notification handler wiring (`:1249-1289`), reconnect handler integration (`:1291-1337`), settings sync from device (`:1413-1432`). Long file — extraction candidates flagged in `status.md`. |
| `src/sdk/notification-dispatcher.ts` | 82 | Pure function `createNotificationHandler` that maps a decoded `DecodeResult` to typed callbacks. The seam between adapter `onNotification(rawBytes)` and `VoltraClient`'s typed listener sets. |
| `src/sdk/reconnect-handler.ts` | 103 | `setupDisconnectMonitor` (`:52-67`) wires adapter state events to `handleUnexpectedDisconnect`. `attemptReconnect` (`:76-103`) loops with delay between attempts. |
| `src/sdk/types.ts` | 232 | All sdk-layer type contracts: `VoltraClientOptions`, `VoltraClientEvent` discriminated union (`:68-88`), `PerRepEvent`/`SummaryEvent`/`PreSummaryEvent`/`InProgressEvent` payload shapes (`:128-200`), listener type aliases. |

### Tests

`src/sdk/__tests__/`:

| Test | Covers |
|------|--------|
| `voltra-manager.test.ts` | Manager scan/connect lifecycle, factory selection, multi-device |
| `voltra-client-setters.test.ts` | All 18 setters (4 core + 8 mode-config + 4 experimental + setMode + setInverseChains) |
| `voltra-client-vendor-events.test.ts` | Typed vendor-frame event emission (perRep/summary/preSummary/inProgress) |
| `notification-dispatcher.test.ts` | Decoder → callback dispatch routing |
| `reconnect-handler.test.ts` | Disconnect monitoring + retry loop |
| `multi-device-routing.test.ts` | Per-client adapter isolation (regression test for 0.4.2 fix) |

## src/voltra/ — protocol + models

| File | Lines | Purpose |
|------|-------|---------|
| `src/voltra/index.ts` | 79 | Voltra-domain barrel (re-exports a subset of protocol + models). Mostly redundant with the root `src/index.ts`; left for internal consumers that want a narrower import. |

### src/voltra/models/

| File | Lines | Purpose |
|------|-------|---------|
| `src/voltra/models/device.ts` | 254 | `VoltraDeviceSettings` interface (`:13-31`), `VoltraRecordingState` type, `DEFAULT_SETTINGS` constant, `VoltraDevice` legacy class (no longer exported, see `MIGRATION.md`). |
| `src/voltra/models/connection.ts` | 78 | `VoltraConnectionState` type (`disconnected`/`connecting`/`authenticating`/`connected`), `isValidVoltraTransition` state-machine guard, `VoltraConnectionStateModel` class. |
| `src/voltra/models/device-filter.ts` | 27 | `isVoltraDevice` and `filterVoltraDevices` — name-prefix filter (`VTR-`) for scan results. |
| `src/voltra/models/telemetry/frame.ts` | 71 | `TelemetryFrame` interface (`:13-26`), `createFrame` helper, phase predicates. |
| `src/voltra/models/telemetry/index.ts` | — | Barrel for telemetry model. |

### src/voltra/protocol/

| File | Lines | Purpose |
|------|-------|---------|
| `src/voltra/protocol/index.ts` | 9 | Barrel re-exporting `constants`, `commands`, `telemetry-decoder`. |
| `src/voltra/protocol/types.ts` | 381 | TypeScript shape of `protocol-data.generated.ts`: `ProtocolData`, `BleConfig`, `CommandConfig`, `TelemetryConfig`, `VendorMessagesConfig`, `VendorSubTypeConfig`, `DeviceSettings` (decoder output, `:365-381`). |
| `src/voltra/protocol/commands.ts` | 413 | Lookup tables for all setters: weights/chains/eccentric/inverseChains (`:21-48`), mode (`:131-156`), 8 mode-config commands (`:163-208`), 4 experimental commands (`:210-232`). Each setter has a `getXCommand(value)` returning bytes-or-null + a `getAvailableX()` returning sorted valid values. |
| `src/voltra/protocol/telemetry-decoder.ts` | 538 | `identifyMessageType` (`:121-163`), `decodeTelemetryFrame` (`:195-220`), four pure vendor decoders (`decodeVendorPerRep` `:245-266`, `decodeVendorSummary` `:274-288`, `decodeVendorPreSummary` `:293-311`, `decodeVendorInProgress` `:328-341`), `decodeNotification` top-level dispatch (`:455-501`), `encodeTelemetryFrame` (`:512-538`) used by replay/mock paths. |
| `src/voltra/protocol/constants/ble-config.ts` | 21 | `BLE.SERVICE_UUID`, `BLE.NOTIFY_CHAR_UUID`, `BLE.WRITE_CHAR_UUID`, `BLE.DEVICE_NAME_PREFIX` — sourced from `protocol-data.generated.ts`. |
| `src/voltra/protocol/constants/timing.ts` | 18 | `Timing.AUTH_TIMEOUT_MS`, `Timing.INIT_COMMAND_DELAY_MS` — fixed delays used by `VoltraClient.authenticate()` / `initialize()`. |
| `src/voltra/protocol/constants/connection-commands.ts` | 57 | `Auth.DEVICE_ID` (iPhone identity), `Init.SEQUENCE` (init commands), `Workout.PREPARE`/`SETUP`/`GO`/`STOP`. |
| `src/voltra/protocol/constants/message-types.ts` | 110 | `MessageTypes.TELEMETRY_STREAM`, `VendorMessages` (vendor sub-type registry), `matchesVendorSubType` predicate (`:53-61`), `TelemetryOffsets`, `NotificationConfigs` (passthrough from generated data), `Uint16ParamIds` set, `ParamIdHex` map. |
| `src/voltra/protocol/constants/enums.ts` | 137 | Hand-authored enums: `MovementPhase` (`:16-22`), `ParameterId` (`:43-54`), `TrainingMode` (`:75-92`), `VendorSchemaVersion` (`:131-136`). Name-map records (`PhaseNames`, `TrainingModeNames`, `ParameterNames`). |
| `src/voltra/protocol/constants/index.ts` | 30 | Barrel re-exporting all constants. |
| `src/voltra/protocol/data/protocol-data.generated.ts` | (large) | `@generated` — single-source-of-truth JSON imported as TS. Regenerated via `npm run generate:protocol` (runs `voltra-private/build.ts`). Contains command byte maps, BLE UUIDs, telemetry offsets, vendor sub-type field maps. |
| `src/voltra/protocol/_factories/*.generated.ts` | 121–346 | `@generated` factories used during the regen pipeline. Internal — not exported. |

### Tests

`src/voltra/protocol/__tests__/`:

| Test | Covers |
|------|--------|
| `commands.test.ts` | Lookup-table coverage for every setter |
| `telemetry-decoder.test.ts` | Frame parsing, settings/multiparam/battery/mode-confirmation paths |
| `telemetry-codec.test.ts` | Encode + decode roundtrip for `TelemetryFrame` |
| `vendor-decoders.test.ts` | The four vendor sub-type decoders (perRep/summary/preSummary/inProgress) |

`src/voltra/models/__tests__/`: `device-filter.test.ts`, `connection.test.ts`, `frame.test.ts`.

## src/bluetooth/ — adapter abstraction

| File | Lines | Purpose |
|------|-------|---------|
| `src/bluetooth/adapters/types.ts` | 116 | `BLEAdapter` interface (`:67-115`), `Device`/`ConnectionState`/`NotificationCallback`/`ConnectionStateCallback` types, `ConnectOptions` (`:35-41`), `BLEServiceConfig` (`:47-56`). |
| `src/bluetooth/adapters/base.ts` | 156 | `BaseBLEAdapter` abstract class. Implements callback registration (`onNotification`, `onConnectionStateChange`) + state utilities (`setConnectionState` `:129-140`, `emitNotification` `:147-155`). Subclasses implement `scan`/`connect`/`disconnect`/`write`. |
| `src/bluetooth/adapters/web-bluetooth-base.ts` | 253 | Shared base for `WebBLEAdapter` and `NodeBLEAdapter` — both run on the W3C Web Bluetooth API (browser native vs. `webbluetooth` polyfill). |
| `src/bluetooth/adapters/web.ts` | 139 | `WebBLEAdapter` — wraps `navigator.bluetooth.requestDevice()` device picker. |
| `src/bluetooth/adapters/node.ts` | 240 | `NodeBLEAdapter` — uses the `webbluetooth` npm polyfill. Adds `DeviceChooser` callback for programmatic selection. |
| `src/bluetooth/adapters/native.ts` | 589 | `NativeBLEAdapter` — uses `react-native-ble-plx`. Includes Android runtime permission requests (`requestAndroidBLEPermissions` `:32-`), iOS state monitoring, app-state-based auto-reconnect. |
| `src/bluetooth/adapters/mock.ts` | 516 | `MockBLEAdapter` — simulates a connected device with realistic telemetry at ~11 Hz. See `testing.md` for full feature list. |
| `src/bluetooth/adapters/index.ts` | 98 | Adapter barrel + `createBLEAdapter` factory (`:86-98`) for env-detection-based instantiation. Note: only handles web/node — RN consumers must instantiate `NativeBLEAdapter` directly via `./native` subpath. |
| `src/bluetooth/models/device.ts` | 36 | `DiscoveredDevice` interface (`:10-17`), display + sort helpers. |
| `src/bluetooth/models/environment.ts` | — | Browser vs. Node env detection helpers. |
| `src/bluetooth/models/connection.ts` | — | Generic `ConnectionState` model (vs. the Voltra-specific one in `voltra/models/connection.ts`). |
| `src/bluetooth/controllers/scanner-controller.ts` | — | Internal scan-state utility. |

### Mock adapter submodules

`src/bluetooth/adapters/mock/`:

| File | Lines | Purpose |
|------|-------|---------|
| `mock/types.ts` | 197 | `MockBLEConfig`, `MockSessionConfig`, `PlannedRepProfile`, `DeviceParameterConfig`, `ResolvedDeviceParams`, error scenario unions, defaults (`MOCK_DEFAULTS`, `SAMPLE_INTERVAL_MS=91`, `FATIGUE_RATE`). |
| `mock/profiles.ts` | 119 | Per-mode kinematics profiles (weight/band/damper/isokinetic/etc.) — phase sequences and force/velocity curves. |
| `mock/kinematics.ts` | 134 | Phase-progression math: position/velocity/force computation per progress fraction. |
| `mock/notifications.ts` | 74 | `buildIdleFrame`, `buildRepBoundary`, `buildSetBoundary`, `buildModeConfirmation`, `detectModeCommand` — emit/recognize raw bytes. |
| `mock/error-injector.ts` | 136 | Error injection state machine: 5 scenario types (disconnect/authTimeout/notificationDrop/malformedFrame/reconnectCycle). |
| `mock/session-config.ts` | 59 | Pre-built scenario factories (`createMultiSetScenario`, `createPauseSetScenario`, `createTempoScenario`, `createShortRestScenario`). |

### Tests

`src/bluetooth/adapters/__tests__/`:

| Test | Covers |
|------|--------|
| `mock.test.ts` | Baseline scan/connect/telemetry emission |
| `mock-session.test.ts` | Multi-set scenarios, rest periods, pause sets |
| `mock-rep-plan.test.ts` | Deterministic rep plan playback |
| `mock-errors.test.ts` | Error injection scenarios |
| `mock-device-params.test.ts` | Battery drain, RSSI noise, identity fields |

## src/react/ — react subpath

| File | Lines | Purpose |
|------|-------|---------|
| `src/react/index.ts` | 19 | Barrel re-exporting `useVoltraScanner`, `useVoltraDevice`, `useVoltra` + state types. |
| `src/react/hooks.ts` | 370 | Hook implementations. `useVoltraScanner` (`:81-135`) tracks scan state via `manager.subscribe`. `useVoltraDevice` (`:177-242`) tracks client state. `useVoltra` (`:279-370`) is the all-in-one combined hook. |

## src/shared/ — utilities

| File | Purpose |
|------|---------|
| `src/shared/utils.ts` | `delay`, `bytesEqual`, `bytesToHex`, `hexToBytes` — used throughout the protocol layer. |
| `src/shared/logger.ts` | `createLogger(scope)` factory + `setDebugEnabled` global toggle. |
| `src/shared/index.ts` | Barrel. |

## src/types/ — ambient declarations

| File | Purpose |
|------|---------|
| `src/types/react-native-ble-plx.d.ts` | Ambient module shim — allows the SDK to compile without `react-native-ble-plx` actually installed (peer dep). |
| `src/types/react-native.d.ts` | Same for `react-native` core APIs (`AppState`, `Platform`, `PermissionsAndroid`). |

## Tests layout

```
src/
├── __tests__/errors.test.ts
├── sdk/__tests__/  (6 files)
├── voltra/protocol/__tests__/  (4 files)
├── voltra/models/__tests__/  (3 files)
└── bluetooth/adapters/__tests__/  (5 files)
```

Test config: `vitest.config.ts` (root). Includes `src/**/*.test.ts`, environment `node`, coverage thresholds 60% lines/functions/statements / 50% branches. See `testing.md`.
