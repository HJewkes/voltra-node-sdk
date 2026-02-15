/**
 * Voltra Domain
 *
 * Voltra device management, telemetry processing, and workout control.
 */

// =============================================================================
// Models
// =============================================================================

// Device model types
export type {
  VoltraDeviceSettings,
  VoltraRecordingState,
  VoltraDeviceState,
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

// Command lookup functions
export {
  getWeightCommand,
  getChainsCommand,
  getEccentricCommand,
  getModeCommand,
  getAvailableWeights,
  getAvailableChains,
  getAvailableEccentric,
  getAvailableModes,
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
  ParameterId,
  ParameterNames,
  TrainingMode,
  TrainingModeNames,
  VALID_TRAINING_MODES,
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
