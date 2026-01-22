/**
 * BLE Abstraction Layer Types
 *
 * Defines interfaces for BLE operations implemented by platform-specific adapters:
 * - Native (iOS/Android): react-native-ble-plx
 * - Browser: Web Bluetooth API
 * - Node.js: webbluetooth npm package
 */

import { type DiscoveredDevice } from '../models/device';

/**
 * Device alias - uses the canonical DiscoveredDevice type from models.
 */
export type Device = DiscoveredDevice;

/**
 * Connection state for the BLE adapter.
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
 * Abstract interface for BLE operations.
 *
 * Implemented by:
 * - NativeBLEAdapter: Uses react-native-ble-plx (iOS/Android)
 * - WebBLEAdapter: Uses Web Bluetooth API (browser)
 * - NodeBLEAdapter: Uses webbluetooth package (Node.js)
 * - ReplayBLEAdapter: Plays back recorded samples (testing/demo)
 */
export interface BLEAdapter {
  /**
   * Scan for devices.
   * @param timeout Scan duration in seconds
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
}
