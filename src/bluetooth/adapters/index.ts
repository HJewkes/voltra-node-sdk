/**
 * BLE Abstraction Layer
 *
 * Provides a unified interface for BLE communication across platforms:
 * - Native (iOS/Android): react-native-ble-plx
 * - Browser: Web Bluetooth API
 * - Node.js: webbluetooth npm package
 */

// Public types
export type {
  BLEAdapter,
  Device,
  ConnectionState,
  NotificationCallback,
  ConnectionStateCallback,
  ConnectOptions,
  BLEServiceConfig,
} from './types';

// Platform adapters
export { WebBLEAdapter } from './web';
export { NodeBLEAdapter, type NodeBLEConfig, type DeviceChooser } from './node';
export { NativeBLEAdapter, type NativeAdapterConfig } from './native';
export { MockBLEAdapter, type MockBLEConfig } from './mock';

// Internal exports (for subclassing if needed, but not part of main API)
// BaseBLEAdapter and WebBluetoothBase are intentionally not exported from main index

import type { BLEAdapter, BLEServiceConfig } from './types';
import { WebBLEAdapter } from './web';
import { NodeBLEAdapter } from './node';

/**
 * Full configuration for creating a BLE adapter.
 */
export interface CreateBLEAdapterConfig {
  /** BLE service configuration (UUIDs, device name prefix) */
  ble: BLEServiceConfig;
}

/**
 * Detect if running in Node.js environment.
 */
function isNodeEnvironment(): boolean {
  return (
    typeof process !== 'undefined' && process.versions != null && process.versions.node != null
  );
}

/**
 * Detect if running in browser environment.
 */
function isBrowserEnvironment(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof navigator !== 'undefined'
  );
}

/**
 * Create a BLE adapter based on the current environment.
 *
 * Environment detection:
 * - Web browser: WebBLEAdapter (Web Bluetooth API)
 * - Node.js: NodeBLEAdapter (webbluetooth package)
 *
 * NOTE: For React Native, import and instantiate NativeBLEAdapter directly.
 * This factory is for web/Node.js environments only.
 *
 * @param config Adapter configuration including BLE service UUIDs
 * @returns BLEAdapter instance appropriate for the current environment
 */
export function createBLEAdapter(config: CreateBLEAdapterConfig): BLEAdapter {
  if (isNodeEnvironment() && !isBrowserEnvironment()) {
    return new NodeBLEAdapter({ ble: config.ble });
  }

  if (isBrowserEnvironment()) {
    return new WebBLEAdapter({ ble: config.ble });
  }

  throw new Error(
    'Unknown environment. For React Native, import NativeBLEAdapter directly from @voltras/node-sdk/react-native'
  );
}
