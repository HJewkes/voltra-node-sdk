/**
 * BLE Abstraction Layer Types
 *
 * Defines interfaces for BLE operations implemented by platform-specific adapters:
 * - Native (iOS/Android): react-native-ble-plx
 * - Browser: Web Bluetooth API
 * - Node.js: webbluetooth npm package
 *
 * Phase 0 (2026-05-08) introduced the `BluetoothHost` + `Peripheral` split
 * alongside the legacy `BLEAdapter`. The new shape separates process-singleton
 * concerns (scan, dial) from per-peripheral concerns (write, notify,
 * disconnect) so multi-device cross-talk becomes a type-level impossibility.
 * The legacy `BLEAdapter` interface remains supported via a shim
 * (`LegacyAdapterPeripheral`) and will be removed in Phase 3.
 *
 * See: coordination/architecture/ble-adapter-refactor-2026-05-08.md
 */

import { type DiscoveredDevice } from '../models/device';

/**
 * Device alias - uses the canonical DiscoveredDevice type from models.
 */
export type Device = DiscoveredDevice;

/**
 * Connection state for the legacy BLE adapter.
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

/**
 * Callback for receiving BLE notifications.
 */
export type NotificationCallback = (data: Uint8Array) => void;

/**
 * Callback for connection state changes.
 */
export type ConnectionStateCallback = (state: ConnectionState) => void;

/**
 * Options for BLE connection.
 */
export interface ConnectOptions {
  /**
   * Data to write immediately after raw connection, before service discovery.
   * Used for authentication that must happen within a tight time window.
   */
  immediateWrite?: Uint8Array;
}

/**
 * BLE service configuration for adapters.
 * Defines the UUIDs and device name prefix for BLE operations.
 */
export interface BLEServiceConfig {
  /** Main service UUID */
  serviceUUID: string;
  /** Characteristic UUID for receiving notifications */
  notifyCharUUID: string;
  /** Characteristic UUID for writing commands */
  writeCharUUID: string;
  /** Optional device name prefix for filtering during scan */
  deviceNamePrefix?: string;
}

/**
 * Abstract interface for BLE operations (legacy).
 *
 * Implemented by:
 * - NativeBLEAdapter: Uses react-native-ble-plx (iOS/Android)
 * - WebBLEAdapter: Uses Web Bluetooth API (browser)
 * - NodeBLEAdapter: Uses webbluetooth package (Node.js)
 * - MockBLEAdapter: In-memory fixture for tests
 *
 * Phase 0 status: still the source of truth for runtime behavior. New
 * code should prefer `BluetoothHost` + `Peripheral`. Existing consumers
 * remain on `BLEAdapter` until Phase 3 deletes it.
 */
export interface BLEAdapter {
  /**
   * Scan for devices.
   * @param timeout Scan duration in milliseconds
   * @returns List of discovered devices
   */
  scan(timeout: number): Promise<Device[]>;

  /**
   * Connect to a device.
   * @param deviceId Device identifier from scan results
   * @param options Optional connection options
   */
  connect(deviceId: string, options?: ConnectOptions): Promise<void>;

  /**
   * Disconnect from the current device.
   */
  disconnect(): Promise<void>;

  /**
   * Write data to the device's write characteristic.
   * @param data Bytes to write
   */
  write(data: Uint8Array): Promise<void>;

  /**
   * Register a callback for notifications from the device.
   * @param callback Function called with notification data
   * @returns Unsubscribe function
   */
  onNotification(callback: NotificationCallback): () => void;

  /**
   * Register a callback for connection state changes.
   * @param callback Function called when state changes
   * @returns Unsubscribe function
   */
  onConnectionStateChange(callback: ConnectionStateCallback): () => void;

  /**
   * Get current connection state.
   */
  getConnectionState(): ConnectionState;

  /**
   * Check if currently connected to a device.
   */
  isConnected(): boolean;

  /**
   * Check if the underlying BLE link is alive end-to-end.
   *
   * Distinct from `isConnected()` (which reports the adapter's tracked
   * connection-state machine). `isLinkAlive()` reports the live state of
   * the write channel — for Web/Node Bluetooth this means `writeChar !==
   * null`; for native (react-native-ble-plx) this means the underlying
   * device handle is still connected.
   *
   * Used by `VoltraClient.ensureConnected()` to detect adapter-level
   * disconnects (e.g., `gattserverdisconnected` racing the connect path)
   * that the client-layer connection state may not yet reflect. See Bug 30
   * (`voltra-private/captures/sessions/2026-05-07T10-12-37/`).
   *
   * NOTE (Phase 0): merged into the new `Peripheral.status` enum's `'lost'`
   * variant — `Peripheral` consumers do not need this dual-truth check.
   */
  isLinkAlive(): boolean;
}

// =============================================================================
// Phase 0 — BluetoothHost + Peripheral split
// =============================================================================

/**
 * Brand symbol distinguishing a `Peripheral` handle from any other shape
 * with `id: string`. Two peripherals from different hosts are non-
 * substitutable in the type system even when their `id` strings match.
 *
 * NOTE: this is a phantom marker — implementations do not actually carry
 * a runtime symbol; the property is `never` on instances.
 */
declare const PeripheralBrand: unique symbol;

/**
 * Brand symbol marking a `Discovery` payload so consumers cannot
 * fabricate one from a string. Real `Discovery` values must come from
 * `BluetoothHost.scan()` or `getKnownDiscoveries()`.
 */
declare const DiscoveryBrand: unique symbol;

/**
 * Single observable status for a `Peripheral`.
 *
 * - `'connecting'`: dial in progress — services not yet discovered.
 * - `'connected'`: GATT link up, write characteristic ready.
 * - `'disconnecting'`: explicit `disconnect()` call in progress.
 * - `'disconnected'`: cleanly disconnected (consumer-initiated or remote
 *   peer dropped after a clean teardown).
 * - `'lost'`: link died mid-flight (`gattserverdisconnected` event,
 *   native disconnect callback, write-fail-with-no-retry, etc.).
 *   Subsumes today's "writeChar nulled but tracked state still
 *   `'connected'`" race condition. The SDK reconnect-handler treats
 *   `'lost'` as the trigger to dial again.
 *
 * Replaces the dual `isConnected()` + `isLinkAlive()` predicates on the
 * legacy `BLEAdapter` interface. Each Peripheral implementation
 * reconciles its underlying-library truth against this single enum.
 */
export type PeripheralStatus =
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'lost';

/**
 * Status-change callback for a `Peripheral`.
 */
export type PeripheralStatusCallback = (status: PeripheralStatus) => void;

/**
 * Options for `Peripheral.write()`.
 */
export interface PeripheralWriteOptions {
  /**
   * Whether to use a write-with-response (`true`, default) or
   * write-without-response operation. Most Voltra commands are
   * write-with-response; raw diagnostic writes occasionally need
   * fire-and-forget semantics.
   */
  withResponse?: boolean;
}

/**
 * A discovered peripheral — opaque handle returned from
 * `BluetoothHost.scan()`. Pass back to `BluetoothHost.dial()` to
 * establish a connection.
 *
 * The branded `_origin` field is host-identity-tied: a `Discovery` from
 * one host cannot be dialed against a different host (compile error if
 * the host types differ; runtime assertion otherwise). The `_payload`
 * carries backend-internal state — for example, on Web/Node it carries
 * the underlying `BluetoothDevice` reference so `dial` does not need to
 * re-scan.
 */
export interface Discovery {
  /** Stable device identifier (BLE address on Linux/Android; UUID on macOS/iOS). */
  readonly id: string;
  /** Advertised device name, or null if not present in the scan record. */
  readonly name: string | null;
  /** Signal strength at scan time (dBm), or null if unavailable. */
  readonly rssi: number | null;
  /** Phantom brand to prevent fabrication from string literals. */
  readonly [DiscoveryBrand]?: never;
  /**
   * Identity of the host that produced this discovery. Runtime check:
   * `host.dial(discovery)` MUST verify `discovery._origin === host` and
   * throw otherwise.
   */
  readonly _origin: BluetoothHost;
  /**
   * Backend-internal payload (e.g. underlying BluetoothDevice on Web/Node).
   * Opaque to consumers.
   */
  readonly _payload: unknown;
}

/**
 * A connected peripheral — one logical handle to one physical device.
 *
 * Each `Peripheral` carries its own deviceId in its type identity so
 * cross-talk cannot be expressed at the type level — the SDK's call
 * sites change from "`adapter.write()` (could route anywhere)" to
 * "`peripheral.write()` (the type tells you which device)."
 *
 * Lifecycle: `BluetoothHost.dial(discovery)` is the only producer. When
 * `status` becomes `'lost'` or `'disconnected'`, the handle is dead and
 * cannot be revived — request a fresh `Peripheral` via another `dial()`.
 */
export interface Peripheral {
  /** Stable device identifier — matches the discovery this was dialed from. */
  readonly id: string;
  /** Device name at dial time, null if not advertised. */
  readonly name: string | null;
  /** Phantom brand to prevent substitution of unrelated `{id: string}` shapes. */
  readonly [PeripheralBrand]?: never;

  /**
   * Current observable status. Single source of truth — replaces the
   * legacy `isConnected()` + `isLinkAlive()` split.
   */
  readonly status: PeripheralStatus;

  /**
   * Write bytes to the device's write characteristic.
   *
   * Throws `PeripheralLost` if the link has died (`status === 'lost'`).
   * Throws `PeripheralRebound` if a runtime id-mismatch is detected
   * between the cached underlying-library handle and this peripheral's
   * declared `id` (catches the upstream `webbluetooth` cross-talk bug
   * AT THE WRITE SITE, before any on-device damage).
   */
  write(data: Uint8Array, options?: PeripheralWriteOptions): Promise<void>;

  /**
   * Subscribe to inbound BLE notifications from this peripheral.
   * Each call returns an unsubscribe function. Multiple listeners are
   * supported — the implementation fans out to all of them.
   */
  onNotification(callback: NotificationCallback): () => void;

  /**
   * Subscribe to status changes. Fires synchronously after each
   * transition. Multiple listeners supported.
   */
  onStatusChange(callback: PeripheralStatusCallback): () => void;

  /**
   * Disconnect this peripheral. Idempotent: calling on an already-
   * disconnected/lost peripheral resolves without error.
   */
  disconnect(): Promise<void>;
}

/**
 * Process-level (or per-host-instance) entry point for BLE discovery
 * and dialing.
 *
 * `BluetoothHost` owns the scan-state lifecycle. It is responsible for
 * producing `Discovery` objects (from `scan()` or `getKnownDiscoveries()`)
 * and converting those into `Peripheral`s via `dial()`. One host can
 * produce many peripherals concurrently; their lifecycles are
 * independent.
 */
export interface BluetoothHost {
  /**
   * Scan for matching peripherals.
   *
   * Returns the discoveries observed during the scan window. Backends
   * with user-gesture-driven scans (browser Web Bluetooth) return at
   * most one. Node and React Native return all matches.
   *
   * @param options Scan options (timeout, filter, etc.).
   */
  scan(options?: HostScanOptions): Promise<Discovery[]>;

  /**
   * Dial a previously-discovered peripheral, returning a connected
   * `Peripheral` handle.
   *
   * Throws if `discovery._origin !== this` (cross-host discovery
   * misuse). Throws if the device is unreachable. The returned
   * `Peripheral` has `status === 'connected'`.
   *
   * @param discovery A `Discovery` produced by THIS host's `scan()` or
   *   `getKnownDiscoveries()`.
   * @param options Optional connect options (e.g. immediate auth write).
   */
  dial(discovery: Discovery, options?: ConnectOptions): Promise<Peripheral>;

  /**
   * Whether this host's underlying BLE stack is available (e.g., the
   * browser supports Web Bluetooth, the BLE adapter is powered on).
   * Backends that cannot answer cheaply may resolve `true` and surface
   * actual problems on `scan()` / `dial()`.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Return persistent-authorization discoveries (e.g., browser
   * `navigator.bluetooth.getDevices()`, native `lastConnectedDeviceId`).
   * Backends without persistent auth return an empty array.
   *
   * Use this to support "auto-reconnect to last device" UX without
   * showing a fresh device picker.
   */
  getKnownDiscoveries(): Promise<Discovery[]>;

  /**
   * Tear down host-level resources (scan handles, AppState listeners,
   * BLE manager instances). Does NOT disconnect peripherals — call
   * `Peripheral.disconnect()` on each one separately.
   */
  dispose(): Promise<void>;
}

/**
 * Scan options for `BluetoothHost.scan()`.
 */
export interface HostScanOptions {
  /** Scan duration in milliseconds. Backends may interpret as a deadline. Default 10000. */
  timeout?: number;
  /**
   * Optional device name prefix filter. When omitted, the host's
   * configured default prefix is used (typically the BLE service config).
   */
  deviceNamePrefix?: string;
}

// =============================================================================
// Phase 0 — Typed errors
// =============================================================================

/**
 * Thrown by `Peripheral.write()` when the underlying BLE link has died
 * (`status === 'lost'`). The SDK's `writeFrame` collapses this and the
 * `'disconnected'` branch into a single `ConnectionError(CONNECTION_LOST)`.
 */
export class PeripheralLost extends Error {
  /** Peripheral identity at the time of the failed write. */
  readonly peripheralId: string;
  /** Status observed when the write was attempted. */
  readonly status: PeripheralStatus;

  constructor(peripheralId: string, status: PeripheralStatus, message?: string) {
    super(message ?? `Peripheral ${peripheralId} is no longer reachable (status=${status})`);
    this.name = 'PeripheralLost';
    this.peripheralId = peripheralId;
    this.status = status;
  }
}

/**
 * Thrown by `Peripheral.write()` when the underlying-library handle has
 * been silently rebound to a DIFFERENT device since this `Peripheral`
 * was dialed. The canonical reproducer is the upstream `webbluetooth`
 * `SimplebleAdapter` singleton bug
 * (`coordination/bug-investigations/sdk-fresh-connect-cross-talk-2026-05-08.md`):
 * a second scan re-discovers an already-connected address and overwrites
 * the singleton's `peripherals` Map entry, so subsequent writes through
 * the old handle resolve to a fresh disconnected shell.
 *
 * Phase 0 catches this AT THE WRITE SITE rather than waiting for
 * on-device damage. The contract test `host-contract.test.ts` exercises
 * this path against every backend.
 */
export class PeripheralRebound extends Error {
  /** Peripheral identity declared at dial time. */
  readonly expectedId: string;
  /** Identity observed on the underlying handle at write time. */
  readonly observedId: string;

  constructor(expectedId: string, observedId: string, message?: string) {
    super(
      message ??
        `Peripheral handle rebound: expected=${expectedId}, observed=${observedId} ` +
          `(upstream library reused the handle for a different device)`
    );
    this.name = 'PeripheralRebound';
    this.expectedId = expectedId;
    this.observedId = observedId;
  }
}
