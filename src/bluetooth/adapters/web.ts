/**
 * WebBLEAdapter
 *
 * BLE adapter for web browsers using the native Web Bluetooth API.
 * Uses the browser's built-in device picker for device selection.
 *
 * Requirements:
 * - Chrome, Edge, or Opera browser (Safari/Firefox don't support Web Bluetooth)
 * - HTTPS or localhost
 * - User gesture required to trigger device picker
 */

import { WebBluetoothBase, type WebBluetoothConfig } from './web-bluetooth-base';
import type { Device, ConnectOptions } from './types';
import { createLogger } from '../../shared/logger';

const log = createLogger('WebBLE');

/**
 * BLE adapter using the browser's native Web Bluetooth API.
 *
 * Device selection flow:
 * 1. Call scan() - triggers browser's device picker
 * 2. User selects device from browser UI
 * 3. scan() returns with the selected device
 * 4. Call connect() to establish GATT connection
 */
export class WebBLEAdapter extends WebBluetoothBase {
  /** Device selected from browser picker, stored for connect() */
  private selectedDevice: BluetoothDevice | null = null;

  constructor(config: WebBluetoothConfig) {
    super(config);
  }

  /**
   * Scan for devices using the browser's device picker.
   *
   * Note: This triggers the browser's native Bluetooth device picker UI.
   * The user must select a device from the picker. Returns when user
   * selects a device or cancels.
   *
   * @param _timeout Ignored - browser controls the picker timeout
   * @returns Array with single selected device, or empty if cancelled
   */
  async scan(_timeout: number): Promise<Device[]> {
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      throw new Error('Web Bluetooth is not available in this browser');
    }

    // Check Bluetooth availability before opening the device picker.
    // requestDevice() can crash the browser tab if Bluetooth is unavailable
    // (no adapter, headless context, permissions blocked).
    if (navigator.bluetooth.getAvailability) {
      const available = await navigator.bluetooth.getAvailability();
      if (!available) {
        throw new Error(
          'Bluetooth is not available. Ensure your device has a Bluetooth adapter and it is enabled.'
        );
      }
    }

    try {
      // Request device from browser - this shows the native picker
      const device = await navigator.bluetooth.requestDevice({
        filters: this.config.deviceNamePrefix
          ? [{ namePrefix: this.config.deviceNamePrefix }]
          : undefined,
        acceptAllDevices: !this.config.deviceNamePrefix,
        optionalServices: [this.config.serviceUUID],
      });

      // Store for connect()
      this.selectedDevice = device;

      log.debug(`Device selected: ${device.name}`);

      return [
        {
          id: device.id,
          name: device.name ?? 'Unknown Device',
          rssi: null, // Not available from requestDevice
        },
      ];
    } catch (error) {
      // User cancelled or error occurred
      if ((error as Error).name === 'NotFoundError') {
        log.debug('User cancelled device selection');
        return [];
      }
      throw error;
    }
  }

  /**
   * Connect to the selected device.
   *
   * Note: In Web Bluetooth, the device is already "selected" during scan().
   * This method establishes the GATT connection.
   *
   * @param deviceId Device ID (should match the selected device)
   * @param options Connection options
   */
  async connect(deviceId: string, options?: ConnectOptions): Promise<void> {
    // Verify we have the device from scan()
    if (!this.selectedDevice) {
      throw new Error('No device selected. Call scan() first.');
    }

    if (this.selectedDevice.id !== deviceId) {
      log.warn(`Device ID mismatch: expected ${this.selectedDevice.id}, got ${deviceId}`);
    }

    // Connect to GATT server
    await this.connectToDevice(this.selectedDevice);

    // Handle immediate write if provided (for authentication)
    if (options?.immediateWrite) {
      log.debug('Sending immediate auth write...');
      await this.write(options.immediateWrite);
      log.debug('Immediate auth write sent');
    }
  }

  /**
   * Override disconnect to also clear selected device.
   */
  override async disconnect(): Promise<void> {
    await super.disconnect();
    this.selectedDevice = null;
  }

  /**
   * Check if Web Bluetooth is supported in this browser.
   */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }
}
