/**
 * Protocol Constants
 *
 * Re-exports all protocol constants from focused modules.
 * Import from this barrel to keep existing import paths working.
 */

export { BLE } from './ble-config';
export { Timing } from './timing';
export { Auth, Init, Workout } from './connection-commands';
export {
  MessageTypes,
  TelemetryOffsets,
  NotificationConfigs,
  Uint16ParamIds,
  ParamIdHex,
  TrainingModeValues,
} from './message-types';
export {
  MovementPhase,
  PhaseNames,
  ParameterId,
  ParameterNames,
  TrainingMode,
  TrainingModeNames,
  VALID_TRAINING_MODES,
} from './enums';
