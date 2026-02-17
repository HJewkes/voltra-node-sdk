/**
 * Bluetooth Domain
 *
 * Generic BLE connection management, device scanning, and environment detection.
 * This domain provides reusable BLE infrastructure that can be configured
 * for any BLE device.
 */

// Models - Device
export type { DiscoveredDevice } from './models/device';
export { getDeviceDisplayName, sortBySignalStrength } from './models/device';

// Models - Connection (internal types, expose only what's needed)
export type { BLEConnectionState } from './models/connection';

// Models - Environment
export type { BLEEnvironment, BLEEnvironmentInfo } from './models/environment';
export {
  detectBLEEnvironment,
  isBLEAvailable,
  createNativeEnvironmentInfo,
} from './models/environment';

// Adapters
export {
  // Types
  type BLEAdapter,
  type BLEServiceConfig,
  type ConnectionState,
  type ConnectOptions,
  type NotificationCallback,
  type ConnectionStateCallback,
  // Adapters
  WebBLEAdapter,
  NodeBLEAdapter,
  NativeBLEAdapter,
  MockBLEAdapter,
  type MockBLEConfig,
  // Factory
  createBLEAdapter,
  type CreateBLEAdapterConfig,
} from './adapters';

// Note: ScannerController is internal - use VoltraClient/VoltraManager for scanning
