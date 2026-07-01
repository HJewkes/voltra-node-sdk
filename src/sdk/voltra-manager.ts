/**
 * VoltraManager
 *
 * Main entry point for the Voltra SDK. Handles device discovery and connection.
 * Returns VoltraClient instances for controlling individual devices.
 *
 * @example
 * ```typescript
 * import { VoltraManager } from '@voltras/node-sdk';
 *
 * const manager = new VoltraManager();
 *
 * // Scan for devices
 * const devices = await manager.scan();
 *
 * // Connect to a device (returns a VoltraClient)
 * const client = await manager.connect(devices[0]);
 *
 * // Or connect by name (scans + connects in one step)
 * const client = await manager.connectByName('VTR-123456');
 *
 * // Use the client
 * await client.setWeight(50);
 * client.onFrame((frame) => console.log(frame.position));
 *
 * // Cleanup
 * manager.dispose();
 * ```
 */

import type { BLEAdapter, BluetoothHost, Discovery } from '../bluetooth/adapters/types';
import { LegacyAdapterHost } from '../bluetooth/adapters/legacy-shim';
import { MockBLEAdapter, type MockBLEConfig } from '../bluetooth/adapters/mock';
import { isMockActivated } from './mock-activation';
import type { DiscoveredDevice } from '../bluetooth/models/device';
import { filterVoltraDevices } from '../voltra/models/device-filter';
import { BLE } from '../voltra/protocol/constants';
import { VoltraClient } from './voltra-client';
import type { VoltraClientOptions, VoltraClientEvent, ScanOptions } from './types';

/**
 * Supported platforms for BLE.
 *
 * - `'node'`: Node.js via the `webbluetooth` package. Default for Node.
 *   Affected by the upstream SimplebleAdapter singleton cross-talk bug
 *   (see `coordination/bug-investigations/sdk-fresh-connect-cross-talk-2026-05-08.md`)
 *   when driving 2+ peripherals concurrently.
 * - `'node-noble'`: Node.js via `@stoprocent/noble`. Multi-peripheral-safe;
 *   opt-in alongside `'node'` for one release. Will become the default in
 *   Phase 4 after on-hardware bilateral validation. Implements the
 *   Phase 0 BluetoothHost/Peripheral interfaces directly (no legacy
 *   BLEAdapter shim).
 */
export type Platform = 'web' | 'node' | 'node-noble' | 'native' | 'mock';

/**
 * Factory function to create a BLE adapter.
 */
export type AdapterFactory = () => BLEAdapter;

/**
 * Options for creating a VoltraManager.
 */
export interface VoltraManagerOptions {
  /**
   * Platform to use. If not specified, auto-detects (web/node).
   * For React Native, use 'native' or import from '@voltras/node-sdk/native'.
   */
  platform?: Platform;

  /**
   * Custom adapter factory. Overrides platform detection.
   * Use this for advanced scenarios or custom adapters.
   */
  adapterFactory?: AdapterFactory;

  /**
   * Pre-built `BluetoothHost`. Overrides `adapterFactory` and `platform`.
   *
   * Phase 0 (2026-05-08): the new entry point for the host/peripheral
   * split. When provided, scan + dial route through this host and each
   * `VoltraClient` is constructed with a `Peripheral` (not an
   * `adapter`). When omitted (the legacy path), the manager builds a
   * `LegacyAdapterHost` around the resolved factory so internal code
   * paths are unified — visible behavior is unchanged.
   *
   * See: coordination/architecture/ble-adapter-refactor-2026-05-08.md
   */
  host?: BluetoothHost;

  /**
   * Options to pass to each VoltraClient.
   */
  clientOptions?: Omit<VoltraClientOptions, 'adapter' | 'peripheral'>;
}

/**
 * Options for connectByName.
 */
export interface ConnectByNameOptions extends ScanOptions {
  /**
   * Match mode for device name.
   * - 'exact': Name must match exactly
   * - 'contains': Name must contain the string (default)
   * - 'startsWith': Name must start with the string
   */
  matchMode?: 'exact' | 'contains' | 'startsWith';
}

/**
 * Manager event types.
 */
export type VoltraManagerEvent =
  | { type: 'deviceConnected'; deviceId: string; deviceName: string | null; client: VoltraClient }
  | { type: 'deviceDisconnected'; deviceId: string }
  | { type: 'deviceError'; deviceId: string; error: Error }
  | { type: 'scanStarted' }
  | { type: 'scanStopped'; devices: DiscoveredDevice[] };

/**
 * Manager event listener.
 */
export type VoltraManagerEventListener = (event: VoltraManagerEvent) => void;

/**
 * Main entry point for the Voltra SDK.
 */
export class VoltraManager {
  private adapterFactory: AdapterFactory;
  private readonly clientOptions: Omit<VoltraClientOptions, 'adapter' | 'peripheral'>;
  private readonly platform: Platform;

  /**
   * Phase 0 host. Either user-supplied via `options.host` or built
   * lazily from `adapterFactory` as a `LegacyAdapterHost`. Owns scan +
   * dial state.
   */
  private host: BluetoothHost;

  // Connected devices
  private clients: Map<string, VoltraClient> = new Map();
  private clientUnsubscribes: Map<string, () => void> = new Map();

  // Discovered devices (from last scan)
  private discoveredDevices: DiscoveredDevice[] = [];
  /**
   * Phase 0 cache of typed `Discovery` handles keyed by deviceId so
   * `connect(device)` can look up the matching discovery for `dial()`.
   * Populated each scan; cleared on dispose.
   */
  private lastDiscoveriesById: Map<string, Discovery> = new Map();

  // Scanning state
  private _isScanning = false;
  /**
   * Legacy compatibility field — kept so `getAdapter()` continues to
   * return the most-recent scan adapter for mock-debug callers. The
   * `Phase 0` `host`/`Peripheral` flow does NOT depend on this.
   */
  private scanAdapter: BLEAdapter | null = null;

  // Event listeners
  private listeners: Set<VoltraManagerEventListener> = new Set();

  // Disposed flag
  private disposed = false;

  constructor(options: VoltraManagerOptions = {}) {
    this.clientOptions = options.clientOptions ?? {};

    if (options.adapterFactory) {
      // Use provided factory
      this.adapterFactory = options.adapterFactory;
      this.platform = options.platform ?? 'web';
    } else if (options.platform) {
      // Use specified platform
      this.platform = options.platform;
      this.adapterFactory = this.createAdapterFactory(options.platform);
    } else {
      // Auto-detect platform
      this.platform = this.detectPlatform();
      this.adapterFactory = this.createAdapterFactory(this.platform);
    }

    // Phase 0: every flow now goes through a BluetoothHost. If the user
    // supplied one, use it directly; otherwise build the host that fits
    // the resolved platform. Phase 1 introduces `'node-noble'` which
    // builds a `NobleHost` directly (no legacy BLEAdapter shim — the
    // noble peripheral implements `Peripheral` natively). All other
    // platforms wrap the adapter factory as a `LegacyAdapterHost`.
    if (options.host) {
      this.host = options.host;
    } else if (this.platform === 'node-noble') {
      this.host = this.createNobleHost();
    } else {
      this.host = new LegacyAdapterHost(this.adapterFactory);
    }
  }

  // ===========================================================================
  // Static Factory Methods
  // ===========================================================================

  /**
   * Create a manager for web browsers.
   */
  static forWeb(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraManager {
    return new VoltraManager({ ...options, platform: 'web' });
  }

  /**
   * Create a manager for Node.js (legacy `webbluetooth` backend).
   *
   * Default Node platform. Affected by the upstream SimplebleAdapter
   * singleton cross-talk bug when driving 2+ peripherals concurrently.
   * For multi-peripheral safety prefer `forNodeNoble()` (Phase 1).
   */
  static forNode(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraManager {
    return new VoltraManager({ ...options, platform: 'node' });
  }

  /**
   * Create a manager for Node.js using the `@stoprocent/noble` backend.
   *
   * Phase 1 (2026-05-08) opt-in alternative to `forNode()`. Implements
   * the BluetoothHost/Peripheral split with per-instance noble peripheral
   * handles, so multi-device cross-talk is impossible at the library
   * layer. Will be promoted to the default Node platform in Phase 4 after
   * bilateral on-hardware validation.
   *
   * Requires `@stoprocent/noble` installed. macOS: terminal must hold
   * Bluetooth permission. See research doc §4 for caveats.
   */
  static forNodeNoble(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraManager {
    return new VoltraManager({ ...options, platform: 'node-noble' });
  }

  /**
   * Create a manager for React Native.
   * Note: Prefer importing from '@voltras/node-sdk/native' instead.
   */
  static forNative(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraManager {
    return new VoltraManager({ ...options, platform: 'native' });
  }

  /**
   * Create a manager with a mock adapter for testing/visual development.
   * Simulates a connected Voltra device with realistic telemetry.
   */
  static forMock(config?: MockBLEConfig): VoltraManager {
    return new VoltraManager({
      platform: 'mock',
      adapterFactory: () => new MockBLEAdapter(config),
    });
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  /**
   * Get all connected device IDs.
   */
  get connectedDeviceIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get number of connected devices.
   */
  get connectedCount(): number {
    return this.clients.size;
  }

  /**
   * Check if scanning is in progress.
   */
  get isScanning(): boolean {
    return this._isScanning;
  }

  /**
   * Get devices discovered in last scan.
   */
  get devices(): DiscoveredDevice[] {
    return [...this.discoveredDevices];
  }

  /**
   * Get the underlying BLE adapter (for mock adapter debug access).
   * Returns null if no adapter has been created yet.
   */
  getAdapter(): BLEAdapter | null {
    return this.scanAdapter;
  }

  // ===========================================================================
  // Device Access
  // ===========================================================================

  /**
   * Get a connected device client by ID.
   */
  getClient(deviceId: string): VoltraClient | undefined {
    return this.clients.get(deviceId);
  }

  /**
   * Get all connected device clients.
   */
  getAllClients(): VoltraClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Check if a device is connected.
   */
  isConnected(deviceId: string): boolean {
    return this.clients.has(deviceId);
  }

  // ===========================================================================
  // Discovery
  // ===========================================================================

  /**
   * Scan for Voltra devices.
   *
   * @param options Scan options
   * @returns Array of discovered Voltra devices
   */
  async scan(options: ScanOptions = {}): Promise<DiscoveredDevice[]> {
    this.ensureNotDisposed();

    const { timeout = 10000, filterVoltra = true } = options;

    this._isScanning = true;
    this.emit({ type: 'scanStarted' });

    try {
      const discoveries = await this.host.scan({ timeout });

      // Cache the typed discoveries by id for `connect(device)` to
      // re-find the matching `Discovery` handle for `host.dial()`.
      this.lastDiscoveriesById = new Map(discoveries.map((d) => [d.id, d]));

      // Surface as DiscoveredDevice[] for backward compat with existing
      // consumers + the manager's `devices` getter.
      const devices: DiscoveredDevice[] = discoveries.map((d) => ({
        id: d.id,
        name: d.name,
        rssi: d.rssi,
      }));

      // Update the legacy `scanAdapter` field from the discovery
      // payload so `getAdapter()` continues to return the underlying
      // adapter (used by mock-debug callers + a few tests). Pulls the
      // adapter reference out of the legacy-host payload shape.
      this.scanAdapter = extractAdapterFromDiscovery(discoveries[0]) ?? this.scanAdapter;

      this.discoveredDevices = filterVoltra ? filterVoltraDevices(devices) : devices;

      this.emit({ type: 'scanStopped', devices: this.discoveredDevices });
      return this.discoveredDevices;
    } finally {
      this._isScanning = false;
    }
  }

  // ===========================================================================
  // Connection
  // ===========================================================================

  /**
   * Connect to a Voltra device.
   *
   * @param device Device to connect to
   * @returns VoltraClient for the connected device
   */
  async connect(device: DiscoveredDevice): Promise<VoltraClient> {
    this.ensureNotDisposed();

    // Check if already connected
    if (this.clients.has(device.id)) {
      return this.clients.get(device.id)!;
    }

    // Phase 0: dial through the BluetoothHost. The host owns scan-state
    // lifecycle; per-peripheral handles come back as `Peripheral`
    // objects, each carrying its own typed identity. Cross-talk (writes
    // to client A landing on device B) becomes a type-level
    // impossibility — `client.adapter.write()` collapses to
    // `peripheral.write()` against this peripheral's id only.
    //
    // The `LegacyAdapterHost` (used when no `host` option is supplied)
    // preserves the legacy "fresh adapter per client" rule + the
    // "first connect after scan reuses scanAdapter" rule internally.
    // Behavior visible to consumers is identical to pre-Phase-0.

    let discovery = this.lastDiscoveriesById.get(device.id);
    if (!discovery) {
      // Legacy fallback: a consumer called `manager.connect(device)`
      // without a prior `scan()` (or after the discovery was already
      // consumed by a previous dial). Synthesize a host-scoped
      // discovery on the fly using a fresh adapter from the factory.
      // This preserves the pre-Phase-0 behavior where the manager
      // would just build a new adapter and call `connect(deviceId)`
      // through it.
      discovery = this.synthesizeDiscovery(device);
    }

    const peripheral = await this.host.dial(discovery);
    // Once consumed, drop the discovery — re-dialing the same handle
    // would attempt to reuse an already-claimed adapter.
    this.lastDiscoveriesById.delete(device.id);
    // Clear scanAdapter too — the legacy host has now consumed it.
    this.scanAdapter = null;

    const client = new VoltraClient({
      ...this.clientOptions,
      peripheral,
    });

    try {
      // The peripheral is already dialed; client.connect() runs auth +
      // init only (the BLE-level connect is short-circuited inside
      // VoltraClient when constructed with `peripheral`).
      await client.connect(device);

      // Store client
      this.clients.set(device.id, client);

      // Subscribe to client events
      const unsubscribe = client.subscribe((event) => {
        this.handleClientEvent(device.id, event);
      });
      this.clientUnsubscribes.set(device.id, unsubscribe);

      // Emit connected event
      this.emit({
        type: 'deviceConnected',
        deviceId: device.id,
        deviceName: device.name ?? null,
        client,
      });

      return client;
    } catch (error) {
      client.dispose();
      // Best-effort: drop the peripheral we dialed but never used.
      peripheral.disconnect().catch(() => {});
      throw error;
    }
  }

  /**
   * Scan for a device by name and connect to it.
   * This is a convenience method that combines scan() and connect().
   *
   * @param namePattern Name or partial name to search for
   * @param options Connection options
   * @returns VoltraClient for the connected device
   * @throws Error if no matching device is found
   *
   * @example
   * ```typescript
   * // Connect to device containing "VTR-123" in its name
   * const client = await manager.connectByName('VTR-123');
   *
   * // Connect to exact name match
   * const client = await manager.connectByName('VTR-123456', { matchMode: 'exact' });
   * ```
   */
  async connectByName(
    namePattern: string,
    options: ConnectByNameOptions = {}
  ): Promise<VoltraClient> {
    this.ensureNotDisposed();

    const { matchMode = 'contains', timeout = 10000, filterVoltra = true } = options;

    // Scan for devices
    const devices = await this.scan({ timeout, filterVoltra });

    // Find matching device
    const device = devices.find((d) => {
      if (!d.name) return false;

      switch (matchMode) {
        case 'exact':
          return d.name === namePattern;
        case 'startsWith':
          return d.name.startsWith(namePattern);
        case 'contains':
        default:
          return d.name.includes(namePattern);
      }
    });

    if (!device) {
      throw new Error(
        `No Voltra device found matching "${namePattern}". ` +
          `Found ${devices.length} device(s): ${devices.map((d) => d.name ?? d.id).join(', ') || 'none'}`
      );
    }

    return this.connect(device);
  }

  /**
   * Connect to the first available Voltra device.
   * Convenience method for single-device scenarios.
   *
   * @param options Scan options
   * @returns VoltraClient for the connected device
   * @throws Error if no devices are found
   */
  async connectFirst(options: ScanOptions = {}): Promise<VoltraClient> {
    const devices = await this.scan(options);

    if (devices.length === 0) {
      throw new Error('No Voltra devices found. Make sure your device is powered on.');
    }

    return this.connect(devices[0]);
  }

  /**
   * Disconnect a specific device.
   */
  async disconnect(deviceId: string): Promise<void> {
    const client = this.clients.get(deviceId);
    if (!client) return;

    const unsubscribe = this.clientUnsubscribes.get(deviceId);
    unsubscribe?.();
    this.clientUnsubscribes.delete(deviceId);

    await client.disconnect();
    client.dispose();
    this.clients.delete(deviceId);

    this.emit({ type: 'deviceDisconnected', deviceId });
  }

  /**
   * Disconnect all devices.
   */
  async disconnectAll(): Promise<void> {
    const deviceIds = Array.from(this.clients.keys());
    await Promise.all(deviceIds.map((id) => this.disconnect(id)));
  }

  // ===========================================================================
  // Event Subscriptions
  // ===========================================================================

  /**
   * Subscribe to manager events.
   */
  subscribe(listener: VoltraManagerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to device connected events.
   */
  onDeviceConnected(
    callback: (client: VoltraClient, deviceId: string, deviceName: string | null) => void
  ): () => void {
    const listener: VoltraManagerEventListener = (event) => {
      if (event.type === 'deviceConnected') {
        callback(event.client, event.deviceId, event.deviceName);
      }
    };
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to device disconnected events.
   */
  onDeviceDisconnected(callback: (deviceId: string) => void): () => void {
    const listener: VoltraManagerEventListener = (event) => {
      if (event.type === 'deviceDisconnected') {
        callback(event.deviceId);
      }
    };
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Dispose of the manager and all connected devices.
   */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.disconnectAll().catch(() => {});
    this.listeners.clear();
    this.clientUnsubscribes.clear();
    this.scanAdapter = null;
    this.lastDiscoveriesById.clear();
    this.host.dispose().catch(() => {});
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private detectPlatform(): Platform {
    // Mock activation (VOLTRA_MOCK env var or setMockActivation()) forces
    // the mock adapter regardless of the real runtime. This is how native
    // and Node builds opt into mock without the web-only `?mock` URL param.
    // An explicit platform/adapterFactory/host bypasses detection entirely.
    if (isMockActivated()) {
      return 'mock';
    }

    // Check for browser environment
    if (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      'bluetooth' in navigator
    ) {
      return 'web';
    }

    // Check for Node.js environment
    if (typeof process !== 'undefined' && process.versions?.node) {
      return 'node';
    }

    // Default to native (React Native)
    // Note: This fallback may not work well - users should specify platform
    return 'native';
  }

  private createAdapterFactory(platform: Platform): AdapterFactory {
    // Map BLE constant (SCREAMING_SNAKE_CASE) to BLEServiceConfig (camelCase)
    const bleConfig = {
      serviceUUID: BLE.SERVICE_UUID,
      notifyCharUUID: BLE.NOTIFY_CHAR_UUID,
      writeCharUUID: BLE.WRITE_CHAR_UUID,
      deviceNamePrefix: BLE.DEVICE_NAME_PREFIX,
    };

    switch (platform) {
      case 'web':
        return () => {
          // Dynamic require to avoid eager-loading platform peers.
          // In the ESM build a `require` shim is prepended at build time
          // (see scripts/inject-esm-require-shim.mjs) so this works in
          // both CommonJS and ECMAScript module contexts.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { WebBLEAdapter } = require('../bluetooth/adapters/web');
          return new WebBLEAdapter({ ble: bleConfig });
        };

      case 'node':
        return () => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { NodeBLEAdapter } = require('../bluetooth/adapters/node');
          return new NodeBLEAdapter({ ble: bleConfig });
        };

      case 'native':
        return () => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { NativeBLEAdapter } = require('../bluetooth/adapters/native');
          return new NativeBLEAdapter({ ble: bleConfig });
        };

      case 'mock':
        // Mock has no platform-specific peer deps, so it's imported
        // eagerly at module top (same as `forMock()`) rather than via a
        // dynamic require.
        return () => new MockBLEAdapter();

      case 'node-noble':
        // node-noble drives a `BluetoothHost` directly (built in
        // `createNobleHost()`); the legacy adapter factory is unused.
        // Return a stub that throws if anything reaches it — that would
        // mean a code path bypassed the host route, which is a bug.
        return () => {
          throw new Error(
            "platform='node-noble' uses BluetoothHost directly — adapterFactory should not be invoked"
          );
        };

      default:
        throw new Error(`Unknown platform: ${platform}`);
    }
  }

  /**
   * Build a `NobleHost` for the `'node-noble'` platform (Phase 1).
   * Lazily requires `@stoprocent/noble` via the adapter file's dynamic
   * import — `NobleHost` itself is imported eagerly here, but it does
   * not pull noble until `scan()`/`isAvailable()`/`dial()`.
   */
  private createNobleHost(): BluetoothHost {
    const bleConfig = {
      serviceUUID: BLE.SERVICE_UUID,
      notifyCharUUID: BLE.NOTIFY_CHAR_UUID,
      writeCharUUID: BLE.WRITE_CHAR_UUID,
      deviceNamePrefix: BLE.DEVICE_NAME_PREFIX,
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NobleHost } = require('../bluetooth/adapters/node-noble');
    return new NobleHost({ ble: bleConfig });
  }

  private handleClientEvent(deviceId: string, event: VoltraClientEvent): void {
    switch (event.type) {
      case 'disconnected':
        if (this.clients.has(deviceId)) {
          const unsubscribe = this.clientUnsubscribes.get(deviceId);
          unsubscribe?.();
          this.clientUnsubscribes.delete(deviceId);

          const client = this.clients.get(deviceId);
          client?.dispose();
          this.clients.delete(deviceId);

          this.emit({ type: 'deviceDisconnected', deviceId });
        }
        break;

      case 'error':
        this.emit({ type: 'deviceError', deviceId, error: event.error });
        break;
    }
  }

  private emit(event: VoltraManagerEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (e) {
        console.error('[VoltraManager] Event listener error:', e);
      }
    });
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Manager has been disposed');
    }
  }

  /**
   * Synthesize a `Discovery` for the legacy "connect-without-scan"
   * path, preserving pre-Phase-0 behavior where `manager.connect(device)`
   * could be called against a known device without first calling
   * `scan()`. Only valid for the default `LegacyAdapterHost` path —
   * user-supplied hosts are assumed to provide their own discoveries.
   */
  private synthesizeDiscovery(device: DiscoveredDevice): Discovery {
    if (!(this.host instanceof LegacyAdapterHost)) {
      throw new Error(
        `manager.connect(${device.id}) requires a prior manager.scan() ` +
          `when using a non-legacy BluetoothHost`
      );
    }
    const adapter = this.adapterFactory();
    const discovery: Discovery = {
      id: device.id,
      name: device.name ?? null,
      rssi: device.rssi ?? null,
      _origin: this.host,
      _payload: { adapter, deviceId: device.id },
    };
    return discovery;
  }
}

/**
 * Extract the underlying `BLEAdapter` from a Phase 0 `Discovery`'s
 * legacy-host payload, when present. Used to keep the deprecated
 * `manager.getAdapter()` accessor functional during Phase 0.
 *
 * Returns `null` when the discovery wasn't produced by a
 * `LegacyAdapterHost` (e.g., a future noble-backed host wouldn't
 * carry an adapter reference). Callers must tolerate `null`.
 */
function extractAdapterFromDiscovery(discovery: Discovery | undefined): BLEAdapter | null {
  if (!discovery) return null;
  const payload = discovery._payload;
  if (
    payload &&
    typeof payload === 'object' &&
    'adapter' in payload &&
    typeof (payload as { adapter?: unknown }).adapter === 'object'
  ) {
    return (payload as { adapter: BLEAdapter }).adapter;
  }
  return null;
}
