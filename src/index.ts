/**
 * @voltra/node-sdk
 *
 * SDK for connecting to and controlling Voltra fitness devices.
 *
 * Use VoltraManager as the main entry point. It handles device discovery
 * and returns VoltraClient instances for controlling individual devices.
 *
 * @example
 * ```typescript
 * import { VoltraManager } from '@voltra/node-sdk';
 *
 * // Create manager (auto-detects platform for web/node)
 * const manager = new VoltraManager();
 *
 * // Scan and connect
 * const devices = await manager.scan();
 * const client = await manager.connect(devices[0]);
 *
 * // Or connect by name in one step
 * const client = await manager.connectByName('VTR-123456');
 *
 * // Control the device
 * await client.setWeight(50);
 * client.onFrame((frame) => console.log('Position:', frame.position));
 * await client.startRecording();
 * ```
 *
 * For React Native, specify the platform:
 * ```typescript
 * const manager = VoltraManager.forNative();
 * // or
 * const manager = new VoltraManager({ platform: 'native' });
 * ```
 */

// =============================================================================
// High-Level API
// =============================================================================

export {
  VoltraClient,
  VoltraManager,
  type Platform,
  type VoltraClientOptions,
  type VoltraClientState,
  type VoltraClientEvent,
  type VoltraClientEventListener,
  type VoltraManagerOptions,
  type VoltraManagerEvent,
  type VoltraManagerEventListener,
  type ConnectByNameOptions,
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
export { createFrame } from './voltra/models/telemetry';

export {
  decodeTelemetryFrame,
  decodeNotification,
  encodeTelemetryFrame,
  identifyMessageType,
  type DecodeResult,
  type MessageType,
} from './voltra/protocol/telemetry-decoder';

export {
  MovementPhase,
  PhaseNames,
  MessageTypes,
  TelemetryOffsets,
} from './voltra/protocol/constants';

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
