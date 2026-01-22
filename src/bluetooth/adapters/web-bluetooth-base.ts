/**
 * WebBluetoothBase
 *
 * Abstract base class for W3C Web Bluetooth API adapters.
 * Provides shared GATT operations for both browser and Node.js environments.
 *
 * Subclasses:
 * - WebBLEAdapter: Browser using navigator.bluetooth
 * - NodeBLEAdapter: Node.js using webbluetooth npm package
 */

import { BaseBLEAdapter } from './base';
import type { Device, ConnectOptions, BLEServiceConfig } from './types';

/**
 * Configuration for Web Bluetooth adapters.
 */
export interface WebBluetoothConfig {
  /** BLE service configuration (UUIDs, device name prefix) */
  ble: BLEServiceConfig;
}

/**
 * Abstract base class for Web Bluetooth adapters.
 *
 * Implements shared GATT operations:
 * - Service/characteristic discovery
 * - Write operations
 * - Notification subscription
 * - Disconnect cleanup
 *
 * Subclasses implement platform-specific device selection (scan/connect).
 */
export abstract class WebBluetoothBase extends BaseBLEAdapter {
  /** Connected Bluetooth device */
  protected device: BluetoothDevice | null = null;

  /** GATT server connection */
  protected server: BluetoothRemoteGATTServer | null = null;

  /** Write characteristic */
  protected writeChar: BluetoothRemoteGATTCharacteristic | null = null;

  /** Notify characteristic */
  protected notifyChar: BluetoothRemoteGATTCharacteristic | null = null;

  /** BLE service configuration */
  protected config: BLEServiceConfig;

  /** Bound notification handler for cleanup */
  private boundNotificationHandler: ((event: Event) => void) | null = null;

  constructor(config: WebBluetoothConfig) {
    super();
    // Web Bluetooth API requires lowercase UUIDs
    this.config = {
      ...config.ble,
      serviceUUID: config.ble.serviceUUID.toLowerCase(),
      writeCharUUID: config.ble.writeCharUUID.toLowerCase(),
      notifyCharUUID: config.ble.notifyCharUUID.toLowerCase(),
    };
  }

  // ===========================================================================
  // Abstract methods - subclasses implement platform-specific device selection
  // ===========================================================================

  /**
   * Scan for devices.
   * Browser: Shows native device picker
   * Node.js: Programmatic device selection
   */
  abstract scan(timeout: number): Promise<Device[]>;

  /**
   * Connect to a device by ID.
   * Subclasses may need to handle device lookup differently.
   */
  abstract connect(deviceId: string, options?: ConnectOptions): Promise<void>;

  // ===========================================================================
  // Shared GATT operations
  // ===========================================================================

  /**
   * Connect to a Bluetooth device's GATT server and set up characteristics.
   * Called by subclasses after device selection.
   */
  protected async connectToDevice(device: BluetoothDevice): Promise<void> {
    this.device = device;

    // Set up disconnect listener
    device.addEventListener('gattserverdisconnected', () => {
      console.log('[WebBluetooth] Device disconnected');
      this.handleDisconnect();
    });

    // Connect to GATT server
    if (!device.gatt) {
      throw new Error('Device does not support GATT');
    }

    this.setConnectionState('connecting');

    try {
      this.server = await device.gatt.connect();
      await this.setupCharacteristics();
      this.setConnectionState('connected');
    } catch (error) {
      console.error('[WebBluetooth] Connect error:', error);
      this.setConnectionState('disconnected');
      throw error;
    }
  }

  /**
   * Discover service and characteristics, set up notifications.
   */
  protected async setupCharacteristics(): Promise<void> {
    if (!this.server) {
      throw new Error('Not connected to GATT server');
    }

    // Get the primary service
    const service = await this.server.getPrimaryService(this.config.serviceUUID);

    // Get write characteristic
    this.writeChar = await service.getCharacteristic(this.config.writeCharUUID);

    // Get notify characteristic and start notifications
    this.notifyChar = await service.getCharacteristic(this.config.notifyCharUUID);

    // Set up notification handler
    this.boundNotificationHandler = this.handleNotification.bind(this);
    this.notifyChar.addEventListener('characteristicvaluechanged', this.boundNotificationHandler);

    await this.notifyChar.startNotifications();

    // Also listen for notifications on write characteristic if it supports it
    if (this.writeChar.properties.notify) {
      this.writeChar.addEventListener('characteristicvaluechanged', this.boundNotificationHandler);
      await this.writeChar.startNotifications();
    }

    console.log('[WebBluetooth] Characteristics set up');
  }

  /**
   * Handle incoming notification data.
   */
  protected handleNotification(event: Event): void {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    if (characteristic.value) {
      const data = new Uint8Array(characteristic.value.buffer);
      this.emitNotification(data);
    }
  }

  /**
   * Handle device disconnection.
   */
  protected handleDisconnect(): void {
    this.cleanup();
    this.setConnectionState('disconnected');
  }

  /**
   * Clean up resources.
   */
  protected cleanup(): void {
    // Remove notification listeners
    if (this.notifyChar && this.boundNotificationHandler) {
      try {
        this.notifyChar.removeEventListener(
          'characteristicvaluechanged',
          this.boundNotificationHandler
        );
      } catch {
        // Ignore errors during cleanup
      }
    }

    if (this.writeChar && this.boundNotificationHandler) {
      try {
        this.writeChar.removeEventListener(
          'characteristicvaluechanged',
          this.boundNotificationHandler
        );
      } catch {
        // Ignore errors during cleanup
      }
    }

    this.boundNotificationHandler = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.server = null;
    this.device = null;
  }

  // ===========================================================================
  // BLEAdapter interface - implemented
  // ===========================================================================

  /**
   * Disconnect from the device.
   */
  async disconnect(): Promise<void> {
    this.setConnectionState('disconnecting');

    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }

    this.cleanup();
    this.setConnectionState('disconnected');
  }

  /**
   * Write data to the device.
   */
  async write(data: Uint8Array): Promise<void> {
    if (!this.writeChar) {
      throw new Error('Not connected to device');
    }

    // Use ArrayBuffer.slice to ensure we have a proper ArrayBuffer
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    await this.writeChar.writeValueWithResponse(buffer);
  }

  // ===========================================================================
  // Extended methods
  // ===========================================================================

  /**
   * Get info about the currently connected device.
   */
  getConnectedDevice(): Device | null {
    if (!this.device) return null;
    return {
      id: this.device.id,
      name: this.device.name ?? 'Unknown',
      rssi: null, // Not available via Web Bluetooth after connection
    };
  }
}
