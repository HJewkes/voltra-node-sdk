/**
 * VoltraManager
 *
 * Manages multiple Voltra device connections for fleet/multi-device scenarios.
 * Use this when you need to connect to and control multiple Voltra devices simultaneously.
 *
 * @example
 * ```typescript
 * import { VoltraManager, NativeBLEAdapter, BLE } from '@voltra/node-sdk';
 *
 * const manager = new VoltraManager({
 *   adapterFactory: () => new NativeBLEAdapter({ ble: BLE }),
 * });
 *
 * // Listen for device events
 * manager.onDeviceConnected((client, deviceId) => {
 *   console.log('Device connected:', deviceId);
 *   client.onFrame((frame) => {
 *     console.log(`[${deviceId}] Position:`, frame.position);
 *   });
 * });
 *
 * manager.onDeviceDisconnected((deviceId) => {
 *   console.log('Device disconnected:', deviceId);
 * });
 *
 * // Scan and connect
 * const devices = await manager.scan();
 * await manager.connect(devices[0]);
 * await manager.connect(devices[1]);
 *
 * // Access specific device
 * const client = manager.getClient('device-id');
 * await client?.setWeight(50);
 *
 * // Cleanup
 * manager.dispose();
 * ```
 */

import type { BLEAdapter } from '../bluetooth/adapters/types';
import type { DiscoveredDevice } from '../bluetooth/models/device';
import { filterVoltraDevices } from '../voltra/models/device-filter';
import { VoltraClient } from './voltra-client';
import type {
  VoltraClientOptions,
  VoltraClientEvent,
  ScanOptions,
} from './types';

/**
 * Factory function to create a BLE adapter.
 * Called once per device connection.
 */
export type AdapterFactory = () => BLEAdapter;

/**
 * Options for creating a VoltraManager.
 */
export interface VoltraManagerOptions {
  /**
   * Factory function to create BLE adapters.
   * Each device connection needs its own adapter instance.
   */
  adapterFactory: AdapterFactory;

  /**
   * Options to pass to each VoltraClient.
   * The adapter option is ignored (uses adapterFactory instead).
   */
  clientOptions?: Omit<VoltraClientOptions, 'adapter'>;
}

/**
 * Manager event types.
 */
export type VoltraManagerEvent =
  | { type: 'deviceConnected'; deviceId: string; client: VoltraClient }
  | { type: 'deviceDisconnected'; deviceId: string }
  | { type: 'deviceError'; deviceId: string; error: Error }
  | { type: 'scanStarted' }
  | { type: 'scanStopped'; devices: DiscoveredDevice[] };

/**
 * Manager event listener.
 */
export type VoltraManagerEventListener = (event: VoltraManagerEvent) => void;

/**
 * Callback for device connected event.
 */
export type DeviceConnectedCallback = (client: VoltraClient, deviceId: string) => void;

/**
 * Callback for device disconnected event.
 */
export type DeviceDisconnectedCallback = (deviceId: string) => void;

/**
 * Manager for multiple Voltra device connections.
 */
export class VoltraManager {
  private readonly adapterFactory: AdapterFactory;
  private readonly clientOptions: Omit<VoltraClientOptions, 'adapter'>;

  // Connected devices
  private clients: Map<string, VoltraClient> = new Map();
  private clientUnsubscribes: Map<string, () => void> = new Map();

  // Discovered devices (from last scan)
  private discoveredDevices: DiscoveredDevice[] = [];

  // Scanning state
  private isScanning = false;
  private scanAdapter: BLEAdapter | null = null;

  // Event listeners
  private listeners: Set<VoltraManagerEventListener> = new Set();

  // Disposed flag
  private disposed = false;

  constructor(options: VoltraManagerOptions) {
    this.adapterFactory = options.adapterFactory;
    this.clientOptions = options.clientOptions ?? {};
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
  get scanning(): boolean {
    return this.isScanning;
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
   *
   * @param deviceId Device ID
   * @returns VoltraClient or undefined if not connected
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
   *
   * @param deviceId Device ID
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
   * Note: In browser environments, this triggers the Web Bluetooth device picker.
   * For multi-device support in browsers, call scan() multiple times.
   *
   * @param options Scan options
   * @returns Array of discovered Voltra devices
   */
  async scan(options: ScanOptions = {}): Promise<DiscoveredDevice[]> {
    this.ensureNotDisposed();

    const { timeout = 10000, filterVoltra = true } = options;

    this.isScanning = true;
    this.emit({ type: 'scanStarted' });

    try {
      // Create a temporary adapter for scanning
      if (!this.scanAdapter) {
        this.scanAdapter = this.adapterFactory();
      }

      const devices = await this.scanAdapter.scan(timeout);
      this.discoveredDevices = filterVoltra ? filterVoltraDevices(devices) : devices;

      this.emit({ type: 'scanStopped', devices: this.discoveredDevices });
      return this.discoveredDevices;
    } finally {
      this.isScanning = false;
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

    // Create new adapter and client for this device
    const adapter = this.adapterFactory();
    const client = new VoltraClient({
      ...this.clientOptions,
      adapter,
    });

    try {
      // Connect
      await client.connect(device);

      // Store client
      this.clients.set(device.id, client);

      // Subscribe to client events
      const unsubscribe = client.subscribe((event) => {
        this.handleClientEvent(device.id, event);
      });
      this.clientUnsubscribes.set(device.id, unsubscribe);

      // Emit connected event
      this.emit({ type: 'deviceConnected', deviceId: device.id, client });

      return client;
    } catch (error) {
      // Clean up on failure
      client.dispose();
      throw error;
    }
  }

  /**
   * Disconnect a specific device.
   *
   * @param deviceId Device ID to disconnect
   */
  async disconnect(deviceId: string): Promise<void> {
    const client = this.clients.get(deviceId);
    if (!client) {
      return;
    }

    // Unsubscribe from client events
    const unsubscribe = this.clientUnsubscribes.get(deviceId);
    unsubscribe?.();
    this.clientUnsubscribes.delete(deviceId);

    // Disconnect and dispose
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
   *
   * @param listener Event listener
   * @returns Unsubscribe function
   */
  subscribe(listener: VoltraManagerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to device connected events.
   *
   * @param callback Callback when a device connects
   * @returns Unsubscribe function
   */
  onDeviceConnected(callback: DeviceConnectedCallback): () => void {
    const listener: VoltraManagerEventListener = (event) => {
      if (event.type === 'deviceConnected') {
        callback(event.client, event.deviceId);
      }
    };
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to device disconnected events.
   *
   * @param callback Callback when a device disconnects
   * @returns Unsubscribe function
   */
  onDeviceDisconnected(callback: DeviceDisconnectedCallback): () => void {
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
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    // Disconnect all devices
    this.disconnectAll().catch(() => {});

    // Clear listeners
    this.listeners.clear();
    this.clientUnsubscribes.clear();

    // Clean up scan adapter
    this.scanAdapter = null;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private handleClientEvent(deviceId: string, event: VoltraClientEvent): void {
    switch (event.type) {
      case 'disconnected':
        // Device disconnected (might be unexpected)
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
