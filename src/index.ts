/**
 * @voltra/node-sdk
 *
 * SDK for connecting to and controlling Voltra fitness devices.
 *
 * This SDK provides:
 * - BLE adapters for React Native, Web, and Node.js
 * - Voltra protocol implementation (authentication, commands, telemetry)
 * - Device discovery and connection management
 * - Real-time telemetry decoding
 */

// =============================================================================
// Bluetooth Layer
// =============================================================================

// Adapters
export {
  // Base classes
  BaseBLEAdapter,
  WebBluetoothBase,
  // Platform adapters
  WebBLEAdapter,
  NodeBLEAdapter,
  NativeBLEAdapter,
  // Factory
  createBLEAdapter,
  // Types
  type BLEAdapter,
  type Device,
  type ConnectionState,
  type NotificationCallback,
  type ConnectionStateCallback,
  type ConnectOptions,
  type BLEServiceConfig,
  type WebBluetoothConfig,
  type NodeBLEConfig,
  type DeviceChooser,
  type NativeAdapterConfig,
  type CreateBLEAdapterConfig,
} from './bluetooth/adapters';

// Models
export {
  // Device
  type DiscoveredDevice,
  getDeviceDisplayName,
  sortBySignalStrength,
  // Connection state
  type BLEConnectionState,
  isValidBLETransition,
  BLEConnectionStateModel,
  // Environment
  type BLEEnvironment,
  type BLEEnvironmentInfo,
  detectBLEEnvironment,
  isBLEAvailable,
  createNativeEnvironmentInfo,
} from './bluetooth/models/device';
export * from './bluetooth/models/connection';
export * from './bluetooth/models/environment';

// Controllers
export {
  ScannerController,
  type ScannerState,
  type ScannerEvent,
  type ScannerEventListener,
  type ScannerConfig,
  type DeviceFilter,
} from './bluetooth/controllers/scanner-controller';

// =============================================================================
// Voltra Layer
// =============================================================================

// Device
export {
  VoltraDevice,
  DEFAULT_SETTINGS,
  type VoltraDeviceSettings,
  type VoltraRecordingState,
  type VoltraDeviceState,
} from './voltra/models/device';

// Connection
export {
  type VoltraConnectionState,
  isValidVoltraTransition,
  VoltraConnectionStateModel,
} from './voltra/models/connection';

// Device filter
export {
  VOLTRA_DEVICE_PREFIX,
  isVoltraDevice,
  filterVoltraDevices,
} from './voltra/models/device-filter';

// Telemetry
export {
  type TelemetryFrame,
  createFrame,
  isActivePhase,
  isConcentricPhase,
  isEccentricPhase,
} from './voltra/models/telemetry';

// Protocol - Commands
export {
  WeightCommands,
  ChainsCommands,
  EccentricCommands,
  type DualCommand,
} from './voltra/protocol/commands';

// Protocol - Constants
export {
  MessageTypes,
  TelemetryOffsets,
  Timing,
  Auth,
  Init,
  Workout,
  BLE,
  MovementPhase,
  PhaseNames,
} from './voltra/protocol/constants';

// Protocol - Decoder
export {
  decodeNotification,
  decodeTelemetryFrame,
  encodeTelemetryFrame,
  identifyMessageType,
  type DecodeResult,
  type MessageType,
} from './voltra/protocol/telemetry-decoder';

// =============================================================================
// Utilities
// =============================================================================

export { delay, hexToBytes, bytesToHex, bytesEqual } from './shared/utils';
