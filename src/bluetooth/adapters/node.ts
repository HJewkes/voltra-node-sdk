/**
 * NodeBLEAdapter
 *
 * BLE adapter for Node.js using the webbluetooth npm package.
 * Implements the same W3C Web Bluetooth API for server-side BLE.
 *
 * Requirements:
 * - Node.js environment
 * - webbluetooth npm package
 * - Platform-specific Bluetooth support (macOS, Linux, Windows)
 */

import { WebBluetoothBase, type WebBluetoothConfig } from './web-bluetooth-base';
import type { Device, ConnectOptions } from './types';

// Dynamic import for webbluetooth to avoid bundling issues in non-Node environments
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let BluetoothClass: any = null;

/**
 * Device chooser function type.
 * Called during scan to programmatically select a device.
 */
export type DeviceChooser = (devices: Device[]) => Device | null;

/**
 * Configuration for Node.js BLE adapter.
 */
export interface NodeBLEConfig extends WebBluetoothConfig {
  /**
   * Optional device chooser function.
   * If not provided, the first matching device is selected.
   */
  deviceChooser?: DeviceChooser;
}

/**
 * BLE adapter for Node.js environments using webbluetooth package.
 *
 * Device selection flow:
 * 1. Call scan() - starts BLE scan
 * 2. Devices are discovered via deviceFound callback
 * 3. deviceChooser function selects a device (or first match by default)
 * 4. Call connect() to establish GATT connection
 */
export class NodeBLEAdapter extends WebBluetoothBase {
  /** Device chooser function for programmatic selection */
  private deviceChooser: DeviceChooser | null;

  /** Device selected during scan, stored for connect() */
  private selectedDevice: BluetoothDevice | null = null;

  /** List of discovered devices during current scan */
  private discoveredDevices: Device[] = [];

  constructor(config: NodeBLEConfig) {
    super(config);
    this.deviceChooser = config.deviceChooser ?? null;
  }

  /**
   * Set the device chooser function.
   * Called during scan to programmatically select a device.
   *
   * @param chooser Function that receives discovered devices and returns the chosen one
   */
  setDeviceChooser(chooser: DeviceChooser): void {
    this.deviceChooser = chooser;
  }

  /**
   * Ensure webbluetooth is loaded (lazy load to avoid bundler issues).
   */
  private async ensureBluetoothLoaded(): Promise<void> {
    if (!BluetoothClass) {
      try {
        // Dynamic import for Node.js - get the Bluetooth class constructor
        const webbluetooth = await import('webbluetooth');
        BluetoothClass = webbluetooth.Bluetooth;
      } catch {
        throw new Error(
          'webbluetooth package not found. Install with: npm install webbluetooth'
        );
      }
    }
  }

  /**
   * Scan for devices programmatically.
   *
   * In Node.js, there's no browser picker. Devices are discovered via
   * the deviceFound callback, and the deviceChooser function selects one.
   *
   * IMPORTANT: The webbluetooth package requires creating a new Bluetooth
   * instance with deviceFound in the constructor for the callback to work
   * reliably. Using the default singleton doesn't call the callback consistently.
   *
   * @param timeout Scan timeout in seconds
   * @returns Array of discovered devices (selection happens via deviceChooser)
   */
  async scan(timeout: number): Promise<Device[]> {
    await this.ensureBluetoothLoaded();

    this.discoveredDevices = [];
    this.selectedDevice = null;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Timeout - return discovered devices
        console.log(`[NodeBLE] Scan timeout. Found ${this.discoveredDevices.length} device(s)`);
        resolve(this.discoveredDevices);
      }, timeout * 1000);

      // Create a new Bluetooth instance with deviceFound in constructor
      // This is required for the callback to fire reliably in webbluetooth
      const bluetooth = new BluetoothClass({
        deviceFound: (device: BluetoothDevice, selectFn: () => void) => {
          // Apply name prefix filter manually (more reliable than built-in filter)
          if (
            this.config.deviceNamePrefix &&
            !device.name?.startsWith(this.config.deviceNamePrefix)
          ) {
            // Device doesn't match prefix, skip it
            return false;
          }

          const discoveredDevice: Device = {
            id: device.id,
            name: device.name ?? 'Unknown Device',
            rssi: null,
          };

          // Add to discovered list
          if (!this.discoveredDevices.find((d) => d.id === device.id)) {
            this.discoveredDevices.push(discoveredDevice);
            console.log(`[NodeBLE] Found device: ${device.name}`);
          }

          // Check if we should select this device
          let shouldSelect = false;

          if (this.deviceChooser) {
            // Use custom chooser
            const chosen = this.deviceChooser(this.discoveredDevices);
            shouldSelect = chosen?.id === device.id;
          } else {
            // Default: select first matching device
            shouldSelect = true;
          }

          if (shouldSelect) {
            console.log(`[NodeBLE] Selected device: ${device.name}`);
            this.selectedDevice = device;
            clearTimeout(timeoutId);
            selectFn();
            return true;
          }

          return false;
        },
      });

      bluetooth
        .requestDevice({
          // Always use acceptAllDevices - we filter manually in deviceFound
          // The built-in namePrefix filter doesn't work reliably
          acceptAllDevices: true,
          optionalServices: [this.config.serviceUUID],
        })
        .then((device: BluetoothDevice) => {
          // Device was selected
          this.selectedDevice = device;
          resolve(this.discoveredDevices);
        })
        .catch((error: Error) => {
          clearTimeout(timeoutId);
          if (error.name === 'NotFoundError') {
            // No device selected
            console.log('[NodeBLE] No device selected');
            resolve(this.discoveredDevices);
          } else {
            reject(error);
          }
        });
    });
  }

  /**
   * Connect to the selected device.
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
      console.warn(
        `[NodeBLE] Device ID mismatch: expected ${this.selectedDevice.id}, got ${deviceId}`
      );
    }

    // Connect to GATT server
    await this.connectToDevice(this.selectedDevice);

    // Handle immediate write if provided (for authentication)
    if (options?.immediateWrite) {
      console.log('[NodeBLE] Sending immediate auth write...');
      await this.write(options.immediateWrite);
      console.log('[NodeBLE] Immediate auth write sent');
    }
  }

  /**
   * Override disconnect to also clear selected device.
   */
  override async disconnect(): Promise<void> {
    await super.disconnect();
    this.selectedDevice = null;
    this.discoveredDevices = [];
  }

  /**
   * Get the list of devices discovered during the last scan.
   */
  getDiscoveredDevices(): Device[] {
    return [...this.discoveredDevices];
  }

  /**
   * Check if running in a Node.js environment.
   */
  static isNodeEnvironment(): boolean {
    return (
      typeof process !== 'undefined' && process.versions != null && process.versions.node != null
    );
  }
}
