/**
 * Bluetooth Domain
 *
 * Generic BLE connection management, device scanning, and environment detection.
 * This domain provides reusable BLE infrastructure that can be configured
 * for any BLE device.
 */

// Models
export * from './models/connection';
export * from './models/device';
export * from './models/environment';

// Controllers
export { ScannerController } from './controllers/scanner-controller';
export type {
  ScannerState,
  ScannerEvent,
  ScannerEventListener,
  ScannerConfig,
  DeviceFilter,
} from './controllers/scanner-controller';

// Adapters
export * from './adapters';
