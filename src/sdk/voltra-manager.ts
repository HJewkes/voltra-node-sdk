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

import type { BLEAdapter } from '../bluetooth/adapters/types';
import type { DiscoveredDevice } from '../bluetooth/models/device';
import { filterVoltraDevices } from '../voltra/models/device-filter';
import { BLE } from '../voltra/protocol/constants';
import { VoltraClient } from './voltra-client';
import type { VoltraClientOptions, VoltraClientEvent, ScanOptions } from './types';

/**
 * Supported platforms for BLE.
 */
export type Platform = 'web' | 'node' | 'native';

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
   * Options to pass to each VoltraClient.
   */
  clientOptions?: Omit<VoltraClientOptions, 'adapter'>;
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
  private readonly clientOptions: Omit<VoltraClientOptions, 'adapter'>;
  private readonly platform: Platform;

  // Connected devices
  private clients: Map<string, VoltraClient> = new Map();
  private clientUnsubscribes: Map<string, () => void> = new Map();

  // Discovered devices (from last scan)
  private discoveredDevices: DiscoveredDevice[] = [];

  // Scanning state
  private _isScanning = false;
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
   * Create a manager for Node.js.
   */
  static forNode(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraManager {
    return new VoltraManager({ ...options, platform: 'node' });
  }

  /**
   * Create a manager for React Native.
   * Note: Prefer importing from '@voltras/node-sdk/native' instead.
   */
  static forNative(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraManager {
    return new VoltraManager({ ...options, platform: 'native' });
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
      // Create adapter for scanning if needed
      if (!this.scanAdapter) {
        this.scanAdapter = this.adapterFactory();
      }

      const devices = await this.scanAdapter.scan(timeout);
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

    // Create new adapter and client
    const adapter = this.adapterFactory();
    const client = new VoltraClient({
      ...this.clientOptions,
      adapter,
    });

    try {
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
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private detectPlatform(): Platform {
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
          // Dynamic import to avoid bundling issues
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

      default:
        throw new Error(`Unknown platform: ${platform}`);
    }
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
}
