/**
 * Legacy adapter <-> Host/Peripheral shim
 *
 * Phase 0 of the BluetoothHost + Peripheral split (2026-05-08). Every
 * existing `BLEAdapter` implementation is wrapped with the shims here so
 * the new interfaces are available without rewriting any backend
 * internals. Internally each shim still drives a `BLEAdapter` — the
 * scan/connect/write/notify implementations are unchanged. The change is
 * which object owns which field:
 *
 * - `LegacyAdapterHost` owns scan + dial + dispose.
 * - `LegacyAdapterPeripheral` owns write + notify + status + disconnect.
 *
 * Phase 1 will add a true noble-backed Host/Peripheral pair that does NOT
 * go through this shim. Phase 3 deletes both `BLEAdapter` and these
 * shims.
 *
 * See: sources/architecture/ble-adapter-refactor-2026-05-08.md §7
 */

import type {
  BLEAdapter,
  BluetoothHost,
  ConnectOptions,
  Discovery,
  HostScanOptions,
  NotificationCallback,
  Peripheral,
  PeripheralStatus,
  PeripheralStatusCallback,
  PeripheralWriteOptions,
} from './types';
import { PeripheralLost } from './types';

/**
 * Optional construction options for the legacy host.
 */
export interface LegacyAdapterHostOptions {
  /**
   * Default scan timeout in milliseconds when `host.scan()` is called
   * without an explicit `timeout`. Mirrors the SDK-layer default. The
   * underlying adapter receives this verbatim.
   */
  defaultScanTimeoutMs?: number;
}

const DEFAULT_SCAN_TIMEOUT_MS = 10_000;

/**
 * Wrap a `BLEAdapter` factory as a `BluetoothHost`. The factory is
 * called once at construction to produce the scan adapter, and then on
 * each `dial()` to produce a fresh per-peripheral adapter — this matches
 * `VoltraManager`'s legacy "fresh adapter per client" rule.
 *
 * The first dial after a scan reuses the scan adapter (which already
 * holds the discovered-device side-effect). Subsequent dials build new
 * adapters via the factory.
 */
export class LegacyAdapterHost implements BluetoothHost {
  private readonly factory: () => BLEAdapter;
  private readonly defaultScanTimeoutMs: number;

  /**
   * Adapter most recently used for a successful scan, retained so the
   * next `dial()` can reuse its discovered-device side-effect (Web/Node
   * `selectedDevice` field). Cleared on consumption.
   */
  private scanAdapter: BLEAdapter | null = null;

  /**
   * Cache of discoveries from the most recent scan, keyed by id. Used
   * to look up the underlying adapter / device reference at `dial()`
   * time.
   */
  private lastDiscoveries: Map<string, Discovery> = new Map();

  private disposed = false;

  constructor(factory: () => BLEAdapter, options: LegacyAdapterHostOptions = {}) {
    this.factory = factory;
    this.defaultScanTimeoutMs = options.defaultScanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
  }

  async scan(options: HostScanOptions = {}): Promise<Discovery[]> {
    this.ensureNotDisposed();

    const timeout = options.timeout ?? this.defaultScanTimeoutMs;

    // Legacy semantic preserved: if a previous scan adapter is still
    // around (scan-then-scan with no intervening dial), reuse it. The
    // pre-Phase-0 manager had this exact rule — re-allocating here
    // would break consumers that rely on `manager.getAdapter()` being
    // stable across scans.
    const adapter = this.scanAdapter ?? this.factory();
    const devices = await adapter.scan(timeout);

    this.scanAdapter = adapter;
    this.lastDiscoveries = new Map();

    const discoveries: Discovery[] = devices.map((d) => {
      const discovery: Discovery = {
        id: d.id,
        name: d.name,
        rssi: d.rssi,
        _origin: this,
        _payload: { adapter, deviceId: d.id },
      };
      this.lastDiscoveries.set(d.id, discovery);
      return discovery;
    });

    return discoveries;
  }

  async dial(discovery: Discovery, options?: ConnectOptions): Promise<Peripheral> {
    this.ensureNotDisposed();

    if (discovery._origin !== this) {
      throw new Error(`Discovery was produced by a different host — cannot dial against this host`);
    }

    const payload = discovery._payload as { adapter: BLEAdapter; deviceId: string } | null;
    if (!payload) {
      throw new Error('Discovery payload is missing — was this discovery synthesized?');
    }

    // Match pre-Phase-0 multi-device-routing semantics:
    //
    //  - First dial after a scan reuses the scan adapter — it already
    //    holds the discovered-device side-effect (Web/Node
    //    `selectedDevice` / `BluetoothDevice` reference) the legacy
    //    `adapter.connect()` needs.
    //  - Every subsequent dial allocates a FRESH adapter via the
    //    factory. Sharing one adapter across multiple peripherals
    //    causes singleton-field cross-talk
    //    (`sources/audits/sdk-fresh-connect-cross-talk-2026-05-08.md`)
    //    and is the bug Phase 1 is moving to fix at the library level.
    //  - When the discovery payload carries its own adapter (synthesized
    //    by the legacy connect-without-scan path), use that adapter
    //    directly — the manager already sized it correctly.
    let adapter: BLEAdapter;
    if (this.scanAdapter && this.scanAdapter === payload.adapter) {
      adapter = this.scanAdapter;
      this.scanAdapter = null;
    } else if (this.scanAdapter || this.lastDiscoveries.size > 0) {
      // Subsequent dial off the same scan — build a fresh adapter so
      // each peripheral owns its own BLE handle.
      adapter = this.factory();
    } else {
      // Synthesized discovery (no live scan state) — its payload
      // already carries a fresh adapter.
      adapter = payload.adapter;
    }

    const peripheral = new LegacyAdapterPeripheral(adapter, discovery.id, discovery.name);

    try {
      await adapter.connect(payload.deviceId, options);
      peripheral._markConnected();
    } catch (e) {
      peripheral._markDead('disconnected');
      throw e;
    }

    return peripheral;
  }

  async isAvailable(): Promise<boolean> {
    // Legacy adapters don't expose an availability check; assume yes
    // and let scan/dial surface real failures.
    return true;
  }

  async getKnownDiscoveries(): Promise<Discovery[]> {
    // Legacy adapters don't model persistent authorization. Return the
    // last scan's discoveries so consumers can re-dial without rescan
    // (within the same host lifetime).
    return Array.from(this.lastDiscoveries.values());
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.scanAdapter = null;
    this.lastDiscoveries.clear();
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('BluetoothHost has been disposed');
    }
  }
}

/**
 * Wrap a `BLEAdapter` as a `Peripheral`. Each instance corresponds to
 * one logical device; the adapter's per-instance `device` / `writeChar`
 * fields are the runtime backing.
 *
 * Status reconciliation:
 * - `'connecting'` — adapter is mid-connect; `_markConnected()` flips
 *   to `'connected'` once the dial resolves.
 * - `'connected'` — adapter reports `isLinkAlive() === true`.
 * - `'lost'` — adapter's `onConnectionStateChange` fired
 *   `'disconnected'` while we were `'connected'` (collapsed from the
 *   legacy dual `isConnected` + `isLinkAlive` predicates). Also entered
 *   when a write fails or `isLinkAlive()` returns false at write time.
 * - `'disconnecting'` / `'disconnected'` — explicit `disconnect()` call.
 */
export class LegacyAdapterPeripheral implements Peripheral {
  readonly id: string;
  readonly name: string | null;

  /**
   * Adapter the SDK still uses for actual BLE I/O. Public-readonly so
   * the `LegacyClientAdapterBridge` (and the disconnect monitor) can
   * subscribe to its lifecycle events without piercing this class. Not
   * part of the `Peripheral` interface — bridge-only access.
   */
  readonly adapter: BLEAdapter;

  private _status: PeripheralStatus = 'connecting';
  private statusCallbacks: PeripheralStatusCallback[] = [];

  /**
   * Track the adapter's connection-state subscription so we can flip
   * to `'lost'` when the underlying library reports a disconnect we
   * didn't request.
   */
  private adapterStateUnsubscribe: (() => void) | null = null;

  constructor(adapter: BLEAdapter, id: string, name: string | null) {
    this.adapter = adapter;
    this.id = id;
    this.name = name;

    // Wire the adapter's connection-state callbacks to our status
    // enum. The legacy adapter fires 'disconnected' on both clean
    // shutdown AND unexpected drops; we map an unexpected drop (while
    // we believed we were 'connected') to 'lost'.
    this.adapterStateUnsubscribe = this.adapter.onConnectionStateChange((legacyState) => {
      if (legacyState === 'disconnected') {
        if (this._status === 'connected' || this._status === 'connecting') {
          this.transition('lost');
        } else if (this._status === 'disconnecting') {
          this.transition('disconnected');
        }
      }
    });
  }

  get status(): PeripheralStatus {
    return this._status;
  }

  async write(data: Uint8Array, _options?: PeripheralWriteOptions): Promise<void> {
    if (this._status !== 'connected') {
      throw new PeripheralLost(this.id, this._status);
    }

    // Bug 30 / cross-talk defense: cross-check the underlying link
    // before issuing the write. If the adapter quietly dropped its
    // write channel, flip to 'lost' BEFORE attempting the write so the
    // surface error is consistent.
    if (!this.adapter.isLinkAlive()) {
      this.transition('lost');
      throw new PeripheralLost(this.id, this._status);
    }

    try {
      await this.adapter.write(data);
    } catch (e) {
      // Legacy adapters throw `Error('Not connected to device')` or
      // similar when the link is dead. Treat any write rejection as
      // proof the link is no longer healthy — flip to 'lost' before
      // re-raising so the SDK can resync state. Wrap in PeripheralLost
      // so callers get a uniform error shape.
      this.transition('lost');
      const message = e instanceof Error ? e.message : String(e);
      throw new PeripheralLost(this.id, this._status, `BLE write failed: ${message}`);
    }
  }

  onNotification(callback: NotificationCallback): () => void {
    return this.adapter.onNotification(callback);
  }

  onStatusChange(callback: PeripheralStatusCallback): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      const idx = this.statusCallbacks.indexOf(callback);
      if (idx >= 0) this.statusCallbacks.splice(idx, 1);
    };
  }

  async disconnect(): Promise<void> {
    if (this._status === 'disconnected' || this._status === 'lost') {
      return;
    }
    this.transition('disconnecting');
    try {
      await this.adapter.disconnect();
    } catch {
      // Legacy adapters log + swallow disconnect errors; ignore here.
    }
    this.transition('disconnected');
  }

  /**
   * Internal hook called by `LegacyAdapterHost.dial()` after the
   * adapter's `connect()` resolves. Flips status to `'connected'`.
   */
  _markConnected(): void {
    if (this._status === 'connecting') {
      this.transition('connected');
    }
  }

  /**
   * Internal hook for failed dial: mark the peripheral as terminally
   * dead without trying to disconnect (the connect call already failed).
   */
  _markDead(state: 'disconnected' | 'lost'): void {
    this.transition(state);
  }

  /**
   * Tear down adapter subscriptions. Used by `Peripheral` consumers
   * (e.g. VoltraClient) to release listener references when the
   * peripheral is no longer needed. Safe to call multiple times.
   */
  _dispose(): void {
    this.adapterStateUnsubscribe?.();
    this.adapterStateUnsubscribe = null;
    this.statusCallbacks = [];
  }

  private transition(next: PeripheralStatus): void {
    if (this._status === next) return;
    this._status = next;
    for (const cb of [...this.statusCallbacks]) {
      try {
        cb(next);
      } catch (e) {
        console.error('[LegacyAdapterPeripheral] status callback error:', e);
      }
    }
  }
}
