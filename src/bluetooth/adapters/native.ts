/**
 * Native BLE Adapter
 *
 * Uses react-native-ble-plx for direct BLE communication on iOS/Android.
 * Includes auto-reconnect functionality for seamless app resume.
 *
 * This adapter is generic and can be configured for any BLE device by
 * providing the appropriate service/characteristic UUIDs.
 *
 * IMPORTANT: This adapter requires react-native-ble-plx as a peer dependency.
 * Install it in your React Native project: npm install react-native-ble-plx
 */

import { BleManager, type Device as BleDevice, State } from 'react-native-ble-plx';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - React Native imports may not be available in all environments
import { AppState, type AppStateStatus, Platform, PermissionsAndroid } from 'react-native';
import { BaseBLEAdapter } from './base';
import type { Device, ConnectOptions, BLEServiceConfig } from './types';

// Re-export BLEServiceConfig for backward compatibility
export type { BLEServiceConfig } from './types';

/**
 * Request Android Bluetooth permissions at runtime.
 * Android 12+ requires BLUETOOTH_SCAN and BLUETOOTH_CONNECT.
 * Android 11 and below require ACCESS_FINE_LOCATION for BLE scanning.
 */
async function requestAndroidBLEPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const apiLevel = Platform.Version;
  console.log('[NativeBLE] Android API level:', apiLevel);

  try {
    if (typeof apiLevel === 'number' && apiLevel >= 31) {
      // Android 12+ (API 31+)
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);

      const allGranted = Object.values(results).every(
        (result) => result === PermissionsAndroid.RESULTS.GRANTED
      );

      if (!allGranted) {
        console.warn('[NativeBLE] Not all permissions granted:', results);
      }

      return allGranted;
    } else {
      // Android 11 and below
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Bluetooth Permission',
          message: 'This app needs access to your location to scan for Bluetooth devices.',
          buttonPositive: 'OK',
        }
      );

      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch (error) {
    console.error('[NativeBLE] Permission request error:', error);
    return false;
  }
}

// Base64 encoding/decoding for BLE data
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Configuration for auto-reconnect behavior.
 */
export interface NativeAdapterConfig {
  /** BLE service configuration */
  ble: BLEServiceConfig;
  /** Enable auto-reconnect when app returns to foreground */
  autoReconnect?: boolean;
  /** Max attempts for auto-reconnect */
  maxReconnectAttempts?: number;
  /** Delay between reconnect attempts (ms) */
  reconnectDelayMs?: number;
}

const DEFAULT_RECONNECT_CONFIG = {
  autoReconnect: true,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
};

/**
 * BLE adapter using react-native-ble-plx for native device communication.
 * Supports auto-reconnect when app resumes from background.
 */
export class NativeBLEAdapter extends BaseBLEAdapter {
  private manager: BleManager;
  private device: BleDevice | null = null;
  private notifySubscription: { remove: () => void } | null = null;
  private writeSubscription: { remove: () => void } | null = null;
  private bleConfig: BLEServiceConfig;
  private autoReconnect: boolean;
  private maxReconnectAttempts: number;
  private reconnectDelayMs: number;

  // Auto-reconnect state
  private lastConnectedDeviceId: string | null = null;
  private lastConnectedDeviceName: string | null = null;
  private isReconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private appStateSubscription: { remove: () => void } | null = null;

  // Disconnect handling - prevents crash when subscriptions error during disconnect
  private isDisconnecting: boolean = false;
  private disconnectSubscription: { remove: () => void } | null = null;

  // Callbacks for reconnect events
  private onReconnectStart?: () => void;
  private onReconnectSuccess?: () => void;
  private onReconnectFailed?: (error: Error) => void;

  constructor(config: NativeAdapterConfig) {
    super();
    this.bleConfig = config.ble;
    this.autoReconnect = config.autoReconnect ?? DEFAULT_RECONNECT_CONFIG.autoReconnect;
    this.maxReconnectAttempts =
      config.maxReconnectAttempts ?? DEFAULT_RECONNECT_CONFIG.maxReconnectAttempts;
    this.reconnectDelayMs = config.reconnectDelayMs ?? DEFAULT_RECONNECT_CONFIG.reconnectDelayMs;
    this.manager = new BleManager();

    // Set up app state listener for auto-reconnect
    if (this.autoReconnect) {
      this.setupAppStateListener();
    }
  }

  /**
   * Set up listener for app state changes (background/foreground).
   */
  private setupAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange.bind(this)
    );
  }

  /**
   * Handle app state changes for auto-reconnect.
   */
  private async handleAppStateChange(nextAppState: AppStateStatus): Promise<void> {
    if (nextAppState === 'active') {
      // App came to foreground
      console.log('[NativeBLE] App became active');

      // Check if we were connected and got disconnected
      if (
        this.lastConnectedDeviceId &&
        this.connectionState === 'disconnected' &&
        !this.isReconnecting
      ) {
        console.log('[NativeBLE] Was connected before, attempting auto-reconnect...');
        await this.attemptReconnect();
      } else if (this.device) {
        // Check if device is still connected
        const isConnected = await this.device.isConnected();
        if (!isConnected) {
          console.log(
            '[NativeBLE] Device disconnected while in background, attempting reconnect...'
          );
          this.setConnectionState('disconnected');
          await this.attemptReconnect();
        }
      }
    }
  }

  /**
   * Attempt to reconnect to the last known device.
   */
  private async attemptReconnect(): Promise<void> {
    if (!this.lastConnectedDeviceId || this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts = 0;
    this.onReconnectStart?.();

    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `[NativeBLE] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
      );

      try {
        await this.connect(this.lastConnectedDeviceId);
        console.log('[NativeBLE] Reconnect successful');
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.onReconnectSuccess?.();
        return;
      } catch (error) {
        console.warn(`[NativeBLE] Reconnect attempt ${this.reconnectAttempts} failed:`, error);

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          await new Promise((resolve) => setTimeout(resolve, this.reconnectDelayMs));
        }
      }
    }

    // All attempts failed
    console.error('[NativeBLE] Auto-reconnect failed after all attempts');
    this.isReconnecting = false;
    this.onReconnectFailed?.(new Error('Auto-reconnect failed'));
  }

  private async waitForPoweredOn(): Promise<void> {
    return new Promise((resolve, reject) => {
      const subscription = this.manager.onStateChange((state) => {
        console.log('[NativeBLE] Bluetooth state:', state);
        if (state === State.PoweredOn) {
          subscription.remove();
          resolve();
        } else if (state === State.Unauthorized) {
          subscription.remove();
          reject(new Error('Bluetooth permission denied. Please enable in Settings.'));
        } else if (state === State.Unsupported) {
          subscription.remove();
          reject(new Error('Bluetooth is not supported on this device.'));
        } else if (state === State.PoweredOff) {
          // Don't reject yet - user might turn it on
          console.log('[NativeBLE] Bluetooth is off - waiting for user to enable');
        }
      }, true);

      // Timeout after 10 seconds
      setTimeout(() => {
        subscription.remove();
        reject(new Error('Timeout waiting for Bluetooth. Please ensure Bluetooth is enabled.'));
      }, 10000);
    });
  }

  async scan(timeout: number): Promise<Device[]> {
    console.log('[NativeBLE] Starting scan...');
    console.log('[NativeBLE] Looking for service:', this.bleConfig.serviceUUID);
    if (this.bleConfig.deviceNamePrefix) {
      console.log('[NativeBLE] Device name prefix:', this.bleConfig.deviceNamePrefix);
    }

    // Request Android permissions first
    const hasPermissions = await requestAndroidBLEPermissions();
    if (!hasPermissions) {
      throw new Error('Bluetooth permissions not granted. Please enable in Settings.');
    }
    console.log('[NativeBLE] Permissions granted');

    await this.waitForPoweredOn();
    console.log('[NativeBLE] Bluetooth is powered on');

    const devices: Device[] = [];
    const seen = new Set<string>();
    const prefix = this.bleConfig.deviceNamePrefix;

    return new Promise((resolve, _reject) => {
      // Scan for all devices (filtering is done by name prefix if configured)
      this.manager.startDeviceScan(
        null, // No service filter - scan for all devices
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            console.error('[NativeBLE] Scan error:', error);
            return;
          }

          if (device) {
            // Log all devices with names for debugging
            if (device.name) {
              console.log(`[NativeBLE] Found device: ${device.name} (${device.id})`);
            }

            // Check if device matches filter (if prefix is configured)
            const matchesFilter =
              !prefix || device.name?.startsWith(prefix) || device.localName?.startsWith(prefix);

            if (matchesFilter && !seen.has(device.id) && (device.name || device.localName)) {
              console.log(
                `[NativeBLE] ✓ Found matching device: ${device.name || device.localName}`
              );
              seen.add(device.id);
              devices.push({
                id: device.id,
                name: device.name || device.localName || 'Unknown Device',
                rssi: device.rssi,
              });
            }
          }
        }
      );

      // Stop scan after timeout
      setTimeout(() => {
        this.manager.stopDeviceScan();
        console.log(`[NativeBLE] Scan complete. Found ${devices.length} device(s)`);
        resolve(devices);
      }, timeout * 1000);
    });
  }

  async connect(deviceId: string, options?: ConnectOptions): Promise<void> {
    // Request Android permissions first
    const hasPermissions = await requestAndroidBLEPermissions();
    if (!hasPermissions) {
      throw new Error('Bluetooth permissions not granted. Please enable in Settings.');
    }

    await this.waitForPoweredOn();

    this.setConnectionState('connecting');

    try {
      // Connect to device - don't request MTU yet, we need to authenticate first
      const device = await this.manager.connectToDevice(deviceId, {
        autoConnect: false, // Use direct connection for faster connect on Android
      });

      this.device = device;
      this.lastConnectedDeviceId = deviceId;
      this.lastConnectedDeviceName = device.name;

      // Discover services and characteristics FIRST (needed for immediate write)
      await device.discoverAllServicesAndCharacteristics();

      // If immediate write is provided, send it NOW before anything else
      // This is critical for devices that require fast authentication
      if (options?.immediateWrite) {
        console.log('[NativeBLE] Sending immediate auth write...');
        const base64 = bytesToBase64(options.immediateWrite);
        await device.writeCharacteristicWithResponseForService(
          this.bleConfig.serviceUUID,
          this.bleConfig.writeCharUUID,
          base64
        );
        console.log('[NativeBLE] Immediate auth write sent');
      }

      // Now request MTU (optional, may fail on some devices)
      try {
        await device.requestMTU(512);
      } catch (mtuError) {
        console.log('[NativeBLE] MTU request failed (non-fatal):', mtuError);
      }

      // Set up disconnect listener BEFORE setting up characteristic monitors
      // This ensures we can clean up subscriptions before the error propagates
      this.disconnectSubscription = device.onDisconnected((error, _disconnectedDevice) => {
        console.log('[NativeBLE] Device disconnected', error ? `(error: ${error.message})` : '');

        // Mark as disconnecting to prevent monitor errors from crashing
        this.isDisconnecting = true;

        // Clean up subscriptions IMMEDIATELY to prevent RxJava crash
        this.cleanupSubscriptions();

        this.setConnectionState('disconnected');
        this.device = null;
        this.isDisconnecting = false;

        // Don't clear lastConnectedDeviceId - we want to try reconnecting
      });

      // Subscribe to notifications on notify characteristic
      // Error callback must handle disconnect gracefully to avoid Android crash
      this.notifySubscription = device.monitorCharacteristicForService(
        this.bleConfig.serviceUUID,
        this.bleConfig.notifyCharUUID,
        (error, characteristic) => {
          if (error) {
            // Ignore errors if we're disconnecting - this prevents the Android crash
            if (this.isDisconnecting || !this.device) {
              console.log(
                '[NativeBLE] Notification error during disconnect (ignored):',
                error.message
              );
              return;
            }
            console.error('[NativeBLE] Notification error:', error);
            return;
          }
          if (characteristic?.value) {
            const bytes = base64ToBytes(characteristic.value);
            this.emitNotification(bytes);
          }
        }
      );

      // Also subscribe to write characteristic (it also sends notifications)
      // Error callback must handle disconnect gracefully to avoid Android crash
      this.writeSubscription = device.monitorCharacteristicForService(
        this.bleConfig.serviceUUID,
        this.bleConfig.writeCharUUID,
        (error, characteristic) => {
          if (error) {
            // Ignore errors if we're disconnecting - this prevents the Android crash
            if (this.isDisconnecting || !this.device) {
              console.log(
                '[NativeBLE] Write char error during disconnect (ignored):',
                error.message
              );
              return;
            }
            console.error('[NativeBLE] Write char notification error:', error);
            return;
          }
          if (characteristic?.value) {
            const bytes = base64ToBytes(characteristic.value);
            this.emitNotification(bytes);
          }
        }
      );

      this.setConnectionState('connected');
    } catch (error) {
      console.error('[NativeBLE] Connect error:', error);
      this.setConnectionState('disconnected');
      throw error;
    }
  }

  private cleanupSubscriptions(): void {
    // Clean up characteristic monitor subscriptions
    // Must be done synchronously to prevent RxJava crash on Android
    if (this.notifySubscription) {
      try {
        this.notifySubscription.remove();
      } catch (e) {
        console.log('[NativeBLE] Error removing notify subscription:', e);
      }
      this.notifySubscription = null;
    }
    if (this.writeSubscription) {
      try {
        this.writeSubscription.remove();
      } catch (e) {
        console.log('[NativeBLE] Error removing write subscription:', e);
      }
      this.writeSubscription = null;
    }
  }

  private cleanupAllSubscriptions(): void {
    this.cleanupSubscriptions();
    if (this.disconnectSubscription) {
      try {
        this.disconnectSubscription.remove();
      } catch (e) {
        console.log('[NativeBLE] Error removing disconnect subscription:', e);
      }
      this.disconnectSubscription = null;
    }
  }

  async disconnect(): Promise<void> {
    this.setConnectionState('disconnecting');

    // Mark as disconnecting to prevent monitor errors from crashing
    this.isDisconnecting = true;

    // Clean up all subscriptions BEFORE canceling connection
    // This prevents the RxJava crash on Android
    this.cleanupAllSubscriptions();

    if (this.device) {
      try {
        await this.device.cancelConnection();
      } catch (error) {
        console.error('[NativeBLE] Disconnect error:', error);
      }
      this.device = null;
    }

    // Clear last device so we don't auto-reconnect after intentional disconnect
    this.lastConnectedDeviceId = null;
    this.lastConnectedDeviceName = null;
    this.isDisconnecting = false;

    this.setConnectionState('disconnected');
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.device) {
      throw new Error('Not connected to device');
    }

    const base64 = bytesToBase64(data);

    await this.device.writeCharacteristicWithResponseForService(
      this.bleConfig.serviceUUID,
      this.bleConfig.writeCharUUID,
      base64
    );
  }

  /**
   * Override isConnected to also check if device exists.
   */
  override isConnected(): boolean {
    return super.isConnected() && this.device !== null;
  }

  /**
   * Get info about the currently connected device.
   */
  getConnectedDevice(): Device | null {
    if (!this.device) return null;
    return {
      id: this.device.id,
      name: this.device.name,
      rssi: null, // Not available after connection
    };
  }

  /**
   * Get the last connected device ID (for reconnection).
   */
  getLastConnectedDeviceId(): string | null {
    return this.lastConnectedDeviceId;
  }

  /**
   * Set callbacks for reconnect events.
   */
  setReconnectCallbacks(callbacks: {
    onStart?: () => void;
    onSuccess?: () => void;
    onFailed?: (error: Error) => void;
  }): void {
    this.onReconnectStart = callbacks.onStart;
    this.onReconnectSuccess = callbacks.onSuccess;
    this.onReconnectFailed = callbacks.onFailed;
  }

  /**
   * Manually trigger a reconnect attempt.
   */
  async reconnect(): Promise<void> {
    if (this.lastConnectedDeviceId) {
      await this.connect(this.lastConnectedDeviceId);
    } else {
      throw new Error('No previous device to reconnect to');
    }
  }

  /**
   * Set the last connected device (for restoring from storage).
   */
  setLastConnectedDevice(deviceId: string, deviceName?: string): void {
    this.lastConnectedDeviceId = deviceId;
    this.lastConnectedDeviceName = deviceName ?? null;
  }

  /**
   * Check if auto-reconnect is in progress.
   */
  isAutoReconnecting(): boolean {
    return this.isReconnecting;
  }

  /**
   * Destroy the BLE manager (call when app is closing).
   */
  destroy(): void {
    this.isDisconnecting = true;
    this.appStateSubscription?.remove();
    this.cleanupAllSubscriptions();
    this.manager.destroy();
  }
}
