/**
 * Message Types & Telemetry Configuration
 *
 * Notification message identifiers, telemetry byte offsets,
 * notification parsing configs, and parameter ID mappings.
 * All values loaded from protocol.json for single source of truth.
 */

import { hexToBytes } from '../../../shared/utils';
import protocolData from '../data/protocol-data.generated';
import type { ProtocolData, VendorSubTypeConfig } from '../types';

const protocol = protocolData as ProtocolData;

// =============================================================================
// Message Type Headers
// =============================================================================

/**
 * Message type identifiers (first 4 bytes of notifications).
 *
 * Only the telemetry stream has a stable 4-byte signature. Frames previously
 * exposed as REP_SUMMARY / SET_SUMMARY / STATUS_UPDATE are now identified
 * via {@link VendorMessages} sub-type matching or the 2-byte statusBattery
 * notification path (see Phase A validation, 2026-05-05).
 */
export const MessageTypes = {
  /** Real-time telemetry stream (~11 Hz) */
  TELEMETRY_STREAM: hexToBytes(protocol.telemetry.messageTypes.stream),
} as const;

// =============================================================================
// Vendor Sub-Type Frames
// =============================================================================

/**
 * Vendor sub-type frame definitions.
 *
 * Vendor frames carry the 0xaa cmd marker at frame offset {@link cmdByteOffset}
 * followed by sub-type identifier bytes. Use {@link matchesVendorSubType} to
 * test a buffer against a sub-type.
 */
export const VendorMessages = {
  cmdByteOffset: protocol.telemetry.vendorMessages.cmdByteOffset,
  cmdValue: protocol.telemetry.vendorMessages.cmdValue,
  subTypes: protocol.telemetry.vendorMessages.subTypes,
} as const;

/**
 * Test whether a notification buffer matches a vendor sub-type by checking
 * the cmd marker and identifier bytes.
 */
export function matchesVendorSubType(data: Uint8Array, subType: VendorSubTypeConfig): boolean {
  if (data[VendorMessages.cmdByteOffset] !== VendorMessages.cmdValue) return false;
  const idStart = VendorMessages.cmdByteOffset + 1;
  if (data.length < idStart + subType.identifierBytes.length) return false;
  for (let i = 0; i < subType.identifierBytes.length; i++) {
    if (data[idStart + i] !== subType.identifierBytes[i]) return false;
  }
  return true;
}

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
