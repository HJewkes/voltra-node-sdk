/**
 * @voltra/node-sdk
 *
 * SDK for connecting to and controlling Voltra fitness devices.
 *
 * This SDK provides:
 * - High-level VoltraClient for simplified device interaction
 * - BLE adapters for React Native, Web, and Node.js
 * - Voltra protocol implementation (authentication, commands, telemetry)
 * - Device discovery and connection management
 * - Real-time telemetry decoding
 *
 * @example
 * ```typescript
 * import { VoltraClient, WebBLEAdapter, BLE } from '@voltra/node-sdk';
 *
 * const adapter = new WebBLEAdapter({ ble: BLE });
 * const client = new VoltraClient({ adapter });
 *
 * const devices = await client.scan();
 * await client.connect(devices[0]);
 * await client.setWeight(50);
 *
 * client.onFrame((frame) => {
 *   console.log('Position:', frame.position);
 * });
 *
 * await client.startRecording();
 * ```
 */

// =============================================================================
// High-Level API
// =============================================================================

export {
  VoltraClient,
  VoltraManager,
  type VoltraClientOptions,
  type VoltraClientState,
  type VoltraClientEvent,
  type VoltraClientEventListener,
  type VoltraManagerOptions,
  type VoltraManagerEvent,
  type VoltraManagerEventListener,
  type DeviceConnectedCallback,
  type DeviceDisconnectedCallback,
  type AdapterFactory,
  type FrameListener,
  type ScanOptions,
} from './sdk';

// =============================================================================
// Platform Adapters
// =============================================================================

export { WebBLEAdapter } from './bluetooth/adapters/web';
export { NodeBLEAdapter, type DeviceChooser } from './bluetooth/adapters/node';
export { NativeBLEAdapter } from './bluetooth/adapters/native';
export { createBLEAdapter } from './bluetooth/adapters';

// Adapter types (what consumers need to implement or use)
export type {
  BLEAdapter,
  BLEServiceConfig,
  ConnectOptions,
  ConnectionState,
  NotificationCallback,
  ConnectionStateCallback,
} from './bluetooth/adapters/types';

// =============================================================================
// Device Discovery
// =============================================================================

export type { DiscoveredDevice } from './bluetooth/models/device';
export { getDeviceDisplayName, sortBySignalStrength } from './bluetooth/models/device';

export {
  VOLTRA_DEVICE_PREFIX,
  isVoltraDevice,
  filterVoltraDevices,
} from './voltra/models/device-filter';

// =============================================================================
// Voltra Device
// =============================================================================

export {
  VoltraDevice,
  DEFAULT_SETTINGS,
  type VoltraDeviceSettings,
  type VoltraRecordingState,
  type VoltraDeviceState,
} from './voltra/models/device';

export type { VoltraConnectionState } from './voltra/models/connection';

// =============================================================================
// Telemetry
// =============================================================================

export type { TelemetryFrame } from './voltra/models/telemetry';

export {
  decodeTelemetryFrame,
  decodeNotification,
  type DecodeResult,
  type MessageType,
} from './voltra/protocol/telemetry-decoder';

export { MovementPhase, PhaseNames } from './voltra/protocol/constants';

// =============================================================================
// Commands
// =============================================================================

export {
  WeightCommands,
  ChainsCommands,
  EccentricCommands,
  type DualCommand,
} from './voltra/protocol/commands';

// =============================================================================
// Protocol Constants
// =============================================================================

export {
  BLE,
  Timing,
  Auth,
  Init,
  Workout,
} from './voltra/protocol/constants';

// =============================================================================
// Errors
// =============================================================================

export {
  VoltraSDKError,
  ConnectionError,
  AuthenticationError,
  TimeoutError,
  NotConnectedError,
  InvalidSettingError,
  BluetoothUnavailableError,
  CommandError,
  TelemetryError,
  ErrorCode,
  type ErrorCode as ErrorCodeType,
} from './errors';

// =============================================================================
// Utilities
// =============================================================================

export { delay } from './shared/utils';
