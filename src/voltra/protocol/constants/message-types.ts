/**
 * Message Types & Telemetry Configuration
 *
 * Notification message identifiers, telemetry byte offsets,
 * notification parsing configs, and parameter ID mappings.
 * All values loaded from protocol.json for single source of truth.
 */

import { hexToBytes } from '../../../shared/utils';
import protocolData from '../data/protocol-data.generated';
import type { ProtocolData } from '../types';

const protocol = protocolData as ProtocolData;

// =============================================================================
// Message Type Headers
// =============================================================================

/**
 * Message type identifiers (first 4 bytes of notifications).
 */
export const MessageTypes = {
  /** Real-time telemetry stream (~11 Hz) */
  TELEMETRY_STREAM: hexToBytes(protocol.telemetry.messageTypes.stream),
  /** Rep completion summary */
  REP_SUMMARY: hexToBytes(protocol.telemetry.messageTypes.repSummary),
  /** Set completion summary */
  SET_SUMMARY: hexToBytes(protocol.telemetry.messageTypes.setSummary),
  /** Status update */
  STATUS_UPDATE: hexToBytes(protocol.telemetry.messageTypes.statusUpdate),
} as const;

// =============================================================================
// Telemetry Offsets
// =============================================================================

/**
 * Byte offsets for parsing telemetry stream messages.
 */
export const TelemetryOffsets = {
  SEQUENCE: protocol.telemetry.offsets.sequence, // 2 bytes, little-endian
  PHASE: protocol.telemetry.offsets.phase, // 1 byte
  POSITION: protocol.telemetry.offsets.position, // 2 bytes, little-endian unsigned
  FORCE: protocol.telemetry.offsets.force, // 2 bytes, little-endian signed
  VELOCITY: protocol.telemetry.offsets.velocity, // 2 bytes, little-endian unsigned
} as const;

// =============================================================================
// Notification Parsing Configs
// =============================================================================

/**
 * Notification parsing configurations loaded from protocol.json.
 * Used to parse various notification types from the device.
 */
export const NotificationConfigs = protocol.telemetry.notifications;

/**
 * Parameter IDs as hex strings (for matching in notifications).
 */
export const ParamIdHex = {
  BASE_WEIGHT: protocol.telemetry.paramIds.baseWeight,
  CHAINS: protocol.telemetry.paramIds.chains,
  ECCENTRIC: protocol.telemetry.paramIds.eccentric,
  TRAINING_MODE: protocol.telemetry.paramIds.trainingMode,
  INVERSE_CHAINS: protocol.telemetry.paramIds.inverseChains,
  UNKNOWN_893E: protocol.telemetry.paramIds.unknown893e,
} as const;

/**
 * Param IDs that use 2-byte (uint16) values in notifications.
 * All other param IDs use 1-byte (uint8) values.
 */
export const Uint16ParamIds: ReadonlySet<string> = new Set(protocol.telemetry.uint16ParamIds ?? []);

/**
 * Training mode values from protocol.json.
 * These map to the TrainingMode enum values.
 */
export const TrainingModeValues = protocol.telemetry.trainingModes;
