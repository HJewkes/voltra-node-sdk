/**
 * Voltra Protocol Constants
 *
 * BLE configuration, authentication, and command constants for
 * Beyond Power Voltra resistance training devices.
 */

import { hexToBytes } from '../../shared/utils';
import protocolData from './data/protocol.json';

// =============================================================================
// BLE Configuration
// =============================================================================

export const BLE = {
  /** Main service UUID for Voltra devices */
  SERVICE_UUID: protocolData.ble.service_uuid,
  /** Characteristic for receiving notifications */
  NOTIFY_CHAR_UUID: protocolData.ble.notify_char_uuid,
  /** Characteristic for writing commands */
  WRITE_CHAR_UUID: protocolData.ble.write_char_uuid,
  /** Device name prefix for scanning (e.g., "VTR-") */
  DEVICE_NAME_PREFIX: protocolData.ble.device_name_prefix,
} as const;

// =============================================================================
// Timing Configuration
// =============================================================================

export const Timing = {
  /** Delay between init commands (ms) */
  INIT_COMMAND_DELAY_MS: 20,
  /** Delay between dual commands like chains/eccentric (ms) */
  DUAL_COMMAND_DELAY_MS: 500,
  /** Timeout for authentication response (ms) */
  AUTH_TIMEOUT_MS: 3000,
  /** Minimum responses expected during auth */
  MIN_AUTH_RESPONSES: 2,
  /** Minimum responses expected after commands */
  MIN_COMMAND_RESPONSES: 4,
} as const;

// =============================================================================
// Authentication
// =============================================================================

/**
 * Device authentication identifiers.
 *
 * 41-byte device IDs that identify the connecting app.
 * Both iPhone and iPad IDs work - the Voltra doesn't care which.
 */
export const Auth = {
  /** iPhone identity from Beyond+ app */
  DEVICE_ID: hexToBytes(protocolData.auth.iphone),
  /** iPad identity (alternative) */
  DEVICE_ID_IPAD: hexToBytes(protocolData.auth.ipad),
} as const;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Minimal 2-command init sequence (reduced from 22+ in Beyond+ app).
 */
export const Init = {
  SEQUENCE: protocolData.init.commands.map(hexToBytes),
} as const;

// =============================================================================
// Workout Commands
// =============================================================================

/**
 * Workout control commands.
 *
 * To start: set weight -> PREPARE -> SETUP -> GO
 * To stop: STOP
 */
export const Workout = {
  /** Prepare for workout (b04f=01) */
  PREPARE: hexToBytes(protocolData.workout.prepare),
  /** Setup workout mode (823e setup) */
  SETUP: hexToBytes(protocolData.workout.setup),
  /** Start resistance (893e=05) */
  GO: hexToBytes(protocolData.workout.go),
  /** Stop resistance (893e=04) */
  STOP: hexToBytes(protocolData.workout.stop),
} as const;

// =============================================================================
// Telemetry Message Types (loaded from protocol.json)
// =============================================================================

/**
 * Message type identifiers (first 4 bytes of notifications).
 * Values loaded from protocol.json for single source of truth.
 */
export const MessageTypes = {
  /** Real-time telemetry stream (~11 Hz) */
  TELEMETRY_STREAM: hexToBytes(protocolData.telemetry.message_types.stream),
  /** Rep completion summary */
  REP_SUMMARY: hexToBytes(protocolData.telemetry.message_types.rep_summary),
  /** Set completion summary */
  SET_SUMMARY: hexToBytes(protocolData.telemetry.message_types.set_summary),
  /** Status update */
  STATUS_UPDATE: hexToBytes(protocolData.telemetry.message_types.status_update),
} as const;

/**
 * Byte offsets for parsing telemetry stream messages.
 * Values loaded from protocol.json for single source of truth.
 */
export const TelemetryOffsets = {
  SEQUENCE: protocolData.telemetry.offsets.sequence, // 2 bytes, little-endian
  PHASE: protocolData.telemetry.offsets.phase, // 1 byte
  POSITION: protocolData.telemetry.offsets.position, // 2 bytes, little-endian unsigned
  FORCE: protocolData.telemetry.offsets.force, // 2 bytes, little-endian signed
  VELOCITY: protocolData.telemetry.offsets.velocity, // 2 bytes, little-endian unsigned
} as const;

/**
 * Movement phase during workout.
 * Values match protocol.json telemetry.phases.
 */
export enum MovementPhase {
  IDLE = 0, // protocolData.telemetry.phases.idle
  CONCENTRIC = 1, // protocolData.telemetry.phases.concentric - Pulling (muscle shortening)
  HOLD = 2, // protocolData.telemetry.phases.hold - Top of rep / transition
  ECCENTRIC = 3, // protocolData.telemetry.phases.eccentric - Releasing (muscle lengthening)
  UNKNOWN = -1,
}

/**
 * Human-readable phase names.
 */
export const PhaseNames: Record<MovementPhase, string> = {
  [MovementPhase.IDLE]: 'Idle',
  [MovementPhase.CONCENTRIC]: 'Pulling',
  [MovementPhase.HOLD]: 'Hold',
  [MovementPhase.ECCENTRIC]: 'Lowering',
  [MovementPhase.UNKNOWN]: 'Unknown',
};
