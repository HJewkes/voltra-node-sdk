/**
 * BaseBLEAdapter
 *
 * Abstract base class for all BLE adapters. Provides shared implementation
 * for connection state management and callback registration/notification.
 *
 * Subclasses implement the platform-specific BLE operations:
 * - NativeBLEAdapter: react-native-ble-plx for iOS/Android
 * - WebBLEAdapter: Web Bluetooth API for browsers
 * - NodeBLEAdapter: webbluetooth npm for Node.js
 * - ReplayBLEAdapter: Playback for testing/demos
 */

import type {
  BLEAdapter,
  Device,
  ConnectionState,
  NotificationCallback,
  ConnectionStateCallback,
  ConnectOptions,
} from './types';

/**
 * Abstract base class implementing shared BLE adapter functionality.
 *
 * Provides:
 * - Connection state management with change notifications
 * - Notification callback registration (supports multiple listeners)
 * - State callback registration (supports multiple listeners)
 * - Protected utilities for subclasses to emit events
 */
export abstract class BaseBLEAdapter implements BLEAdapter {
  /** Current connection state */
  protected connectionState: ConnectionState = 'disconnected';

  /** Registered notification callbacks */
  protected notificationCallbacks: NotificationCallback[] = [];

  /** Registered connection state callbacks */
  protected stateCallbacks: ConnectionStateCallback[] = [];

  // ===========================================================================
  // BLEAdapter interface - implemented
  // ===========================================================================

  /**
   * Get the current connection state.
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if currently connected to a device.
   */
  isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  /**
   * Register a callback for notifications from the device.
   * @param callback Function called with notification data
   * @returns Unsubscribe function
   */
  onNotification(callback: NotificationCallback): () => void {
    this.notificationCallbacks.push(callback);
    return () => {
      const index = this.notificationCallbacks.indexOf(callback);
      if (index >= 0) {
        this.notificationCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Register a callback for connection state changes.
   * @param callback Function called when state changes
   * @returns Unsubscribe function
   */
  onConnectionStateChange(callback: ConnectionStateCallback): () => void {
    this.stateCallbacks.push(callback);
    return () => {
      const index = this.stateCallbacks.indexOf(callback);
      if (index >= 0) {
        this.stateCallbacks.splice(index, 1);
      }
    };
  }

  // ===========================================================================
  // BLEAdapter interface - abstract (subclasses implement)
  // ===========================================================================

  /**
   * Scan for devices.
   * @param timeout Scan duration in seconds
   * @returns List of discovered devices
   */
  abstract scan(timeout: number): Promise<Device[]>;

  /**
   * Connect to a device.
   * @param deviceId Device identifier from scan results
   * @param options Optional connection options
   */
  abstract connect(deviceId: string, options?: ConnectOptions): Promise<void>;

  /**
   * Disconnect from the current device.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Write data to the device's write characteristic.
   * @param data Bytes to write
   */
  abstract write(data: Uint8Array): Promise<void>;

  // ===========================================================================
  // Protected utilities for subclasses
  // ===========================================================================

  /**
   * Set connection state and notify all registered callbacks.
   * Only notifies if state actually changed.
   *
   * @param state New connection state
   */
  protected setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      for (const callback of this.stateCallbacks) {
        try {
          callback(state);
        } catch (e) {
          console.error('[BaseBLEAdapter] State callback error:', e);
        }
      }
    }
  }

  /**
   * Emit notification data to all registered callbacks.
   *
   * @param data Notification data to emit
   */
  protected emitNotification(data: Uint8Array): void {
    for (const callback of this.notificationCallbacks) {
      try {
        callback(data);
      } catch (e) {
        console.error('[BaseBLEAdapter] Notification callback error:', e);
      }
    }
  }
}
