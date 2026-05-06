# Adapters

Architecture and selection of the four `BLEAdapter` implementations.

## Contents

- [Interface contract](#interface-contract)
- [Adapter table](#adapter-table)
- [Selection logic](#selection-logic)
- [Per-adapter notes](#per-adapter-notes)
- [Lazy loading and peer dependencies](#lazy-loading-and-peer-dependencies)
- [Adapter lifecycle in VoltraManager](#adapter-lifecycle-in-voltramanager)

For platform-specific user-facing setup (permissions, browser support, OS prerequisites) see `docs/concepts/platform-adapters.md` — this file is the internal architecture view.

## Interface contract

`BLEAdapter` (`bluetooth/adapters/types.ts:67-115`):

```ts
interface BLEAdapter {
  scan(timeout: number): Promise<Device[]>;
  connect(deviceId: string, options?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  onNotification(callback: NotificationCallback): () => void;
  onConnectionStateChange(callback: ConnectionStateCallback): () => void;
  getConnectionState(): ConnectionState;
  isConnected(): boolean;
}
```

`BaseBLEAdapter` (`bluetooth/adapters/base.ts:32-156`) implements callback registration and state tracking. Subclasses implement the four abstract methods (`scan`, `connect`, `disconnect`, `write`).

`ConnectionState` is `'disconnected' | 'connecting' | 'connected' | 'disconnecting'` — adapter-level. The Voltra-specific `VoltraConnectionState` adds `'authenticating'` and lives in `voltra/models/connection.ts`.

## Adapter table

| Adapter | Source | Backing API | Required peer dep | Use case |
|---------|--------|-------------|-------------------|----------|
| `WebBLEAdapter` | `bluetooth/adapters/web.ts` | `navigator.bluetooth` (W3C Web Bluetooth) | none (browser-native) | Chrome/Edge/Opera browser apps |
| `NodeBLEAdapter` | `bluetooth/adapters/node.ts` | `webbluetooth` npm package (W3C-compatible polyfill) | `webbluetooth` (declared as `optionalDependencies`) | CLI tools, server-to-device relays, Node tests |
| `NativeBLEAdapter` | `bluetooth/adapters/native.ts` | `react-native-ble-plx` | `react-native-ble-plx >=3.0.0` | iOS / Android React Native apps |
| `MockBLEAdapter` | `bluetooth/adapters/mock.ts` | (in-process simulation) | none | Tests, demos, MCP dev mode, Playwright |

Web and Node share the `WebBluetoothBase` class (`bluetooth/adapters/web-bluetooth-base.ts`, 253 lines) since both target the same W3C API.

## Selection logic

Three paths for choosing an adapter:

### 1. Explicit factory (recommended)

```ts
const m = VoltraManager.forWeb();    // voltra-manager.ts:149
const m = VoltraManager.forNode();   // voltra-manager.ts:156
const m = VoltraManager.forNative(); // voltra-manager.ts:164
const m = VoltraManager.forMock();   // voltra-manager.ts:172
```

### 2. Auto-detection

`VoltraManager` constructor with no `platform` option calls `detectPlatform()` (`voltra-manager.ts:506-524`):

| Detection | Result |
|-----------|--------|
| `window.navigator.bluetooth` exists | `'web'` |
| `process.versions.node` exists | `'node'` |
| else | `'native'` (fallback — RN consumers should pass `platform: 'native'` explicitly) |

`createBLEAdapter()` (`bluetooth/adapters/index.ts:86-98`) does similar but only handles web and node — RN must instantiate `NativeBLEAdapter` directly.

### 3. Custom adapter factory

```ts
new VoltraManager({ adapterFactory: () => new MyCustomAdapter() })
```

Used by `VoltraManager.forMock` internally (`voltra-manager.ts:172-177`).

## Per-adapter notes

### WebBLEAdapter

`bluetooth/adapters/web.ts` (139 lines).

- `scan(timeout)` ignores `timeout` — calls `navigator.bluetooth.requestDevice()` which shows the browser's modal device picker (`web.ts:46-`).
- Returns a single-element array with the user-selected device, or empty if cancelled.
- `selectedDevice` is held on the adapter instance from `scan()` to `connect()` — this is why `VoltraManager.connect` reuses `scanAdapter` for the first connect after a scan (`voltra-manager.ts:307-313`).

### NodeBLEAdapter

`bluetooth/adapters/node.ts` (240 lines).

- Lazy-loads `webbluetooth` via dynamic `import()` (`node.ts:21,77-`) so non-Node consumers don't pay the cost.
- Adds a `DeviceChooser` callback (`node.ts:27`) for programmatic selection during multi-device scans. Default: pick first match.
- Same `selectedDevice`-during-scan semantics as Web. The 0.6.1 hotfix (`fix/scan-adapter-reuse-node` branch) removes a platform gate that previously prevented `scanAdapter` reuse on node, fixing "No device selected. Call scan() first." regressions on multi-device fan-out.

### NativeBLEAdapter

`bluetooth/adapters/native.ts` (589 lines).

- Imports `react-native-ble-plx` and `react-native` core APIs at top level — must NOT be loaded outside an RN app, hence the type-only re-export at the package root.
- Handles Android runtime permissions (`requestAndroidBLEPermissions` `:32-`): `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION` for API 31+; legacy permissions for earlier APIs.
- iOS state monitoring via `AppState`. Reconnects when app returns from background.
- Uniquely supports an internal auto-reconnect loop (separate from `VoltraClient`'s reconnect handler) for app-state events.

### MockBLEAdapter

`bluetooth/adapters/mock.ts` (516 lines, plus 6-file `mock/` submodule). See `testing.md` for full feature list.

Highlights:

- Emits encoded 30-byte telemetry frames via `encodeTelemetryFrame` at ~11 Hz (`SAMPLE_INTERVAL_MS = 91`).
- 7 training-mode kinematics profiles (`mock/profiles.ts` → `KINEMATICS_PROFILES`).
- 5 error scenarios (`mock/error-injector.ts`): disconnect, authTimeout, notificationDrop, malformedFrame, reconnectCycle.
- Multi-set sessions via `MockSessionConfig` (rest periods, pause sets, tempo overrides, fatigue model).
- Deterministic rep plans via `setRepPlan(profiles)` (`mock.ts:172-`) — bypasses the kinematics profile and plays back exact timing/ROM per rep.
- Battery drain (`BATTERY_DRAIN_PER_MS = 1/60_000` → 1%/min during motor engagement) and RSSI gaussian noise (σ=5 dBm).

## Lazy loading and peer dependencies

`VoltraManager.createAdapterFactory(platform)` (`voltra-manager.ts:526-571`) returns a thunk that does a CommonJS `require()` at call time. This deferred import is what keeps non-RN consumers from accidentally pulling in `react-native-ble-plx`:

```ts
case 'native':
  return () => {
    const { NativeBLEAdapter } = require('../bluetooth/adapters/native');
    return new NativeBLEAdapter({ ble: bleConfig });
  };
```

The ESM build emits this `require()` literally. To make it work under stock Node ESM, `scripts/inject-esm-require-shim.mjs` prepends a `createRequire(import.meta.url)` banner to `dist/esm/sdk/voltra-manager.js` after `tsc` runs (see `overview.md`).

The package root `src/index.ts:76-78` exports the adapter classes as **type-only**. Consumers wanting the value (e.g. for direct instantiation outside the manager) import from `@voltras/node-sdk/native | /node | /web`. `MockBLEAdapter` is exported as a value at the root because it has no peer dependency.

## Adapter lifecycle in VoltraManager

`VoltraManager` allocates one BLE adapter per `VoltraClient` (the per-client adapter pattern landed in 0.4.2). Logic in `connect()` (`voltra-manager.ts:288-345`):

1. If `this.scanAdapter` exists (from a prior `scan()`), reuse it for this connect — it already holds the `selectedDevice` reference. Set `scanAdapter = null` after takeover.
2. Otherwise, call `this.adapterFactory()` to build a fresh adapter.
3. Construct `new VoltraClient({ adapter })`, `await client.connect(device)`.
4. Subscribe to client events to bridge `disconnected` and `error` events into manager-level events.

This per-client allocation is essential for multi-device support: a shared adapter would clobber its singleton `device`/`server`/`writeChar` fields on each connect, routing all writes to the most-recently-connected peripheral. Pre-0.4.2 the adapter was shared. See `coordination` notes referenced from `MEMORY.md`.

`scanAdapter` reuse semantics are platform-agnostic. Pre-0.6.1 a `platform === 'web'` gate skipped reuse on node, breaking "scan then connect" on Node — fixed in `fix/scan-adapter-reuse-node` (see `release.md`).
