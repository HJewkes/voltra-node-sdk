/**
 * Voltra Domain
 *
 * Voltra device management, telemetry processing, and workout control.
 */

// =============================================================================
// Models
// =============================================================================

// Device model
export {
  VoltraDevice,
  DEFAULT_SETTINGS,
  type VoltraDeviceSettings,
  type VoltraRecordingState,
  type VoltraDeviceState,
} from './models/device';

// Connection model
export {
  type VoltraConnectionState,
  isValidVoltraTransition,
  VoltraConnectionStateModel,
} from './models/connection';

// Device filter
export { VOLTRA_DEVICE_PREFIX, isVoltraDevice, filterVoltraDevices } from './models/device-filter';

// Telemetry models
export {
  type TelemetryFrame,
  createFrame,
  isActivePhase,
  isConcentricPhase,
  isEccentricPhase,
} from './models/telemetry';

// =============================================================================
// Protocol
// =============================================================================

// Command builders
export {
  WeightCommands,
  ChainsCommands,
  EccentricCommands,
  type DualCommand,
} from './protocol/commands';

// Protocol constants
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
} from './protocol/constants';

// Telemetry decoder (low-level)
export {
  decodeNotification,
  decodeTelemetryFrame,
  encodeTelemetryFrame,
  identifyMessageType,
  type DecodeResult,
  type MessageType,
} from './protocol/telemetry-decoder';
