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
 * Message type identifiers.
 *
 * Only the telemetry stream has a stable fixed-length signature. Frames previously
 * exposed under their own message-type names are now identified
 * via {@link VendorMessages} sub-type matching or the statusBattery
 * notification path (validated on-device 2026-05-05).
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
 * Use {@link matchesVendorSubType} to test a buffer against a sub-type.
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
  SEQUENCE: protocol.telemetry.offsets.sequence,
  PHASE: protocol.telemetry.offsets.phase,
  POSITION: protocol.telemetry.offsets.position, // millimetres
  FORCE: protocol.telemetry.offsets.force, // tenths of pounds
  VELOCITY: protocol.telemetry.offsets.velocity, // mm/s, sign flips with direction
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
  BP_SET_FITNESS_MODE: protocol.telemetry.paramIds.bpSetFitnessMode,
  /** Damper level. Undefined on protocol data that does not name it. */
  DAMPER_LEVEL: protocol.telemetry.paramIds.damperLevel,
  /** Battery percentage. Undefined on protocol data that does not name it. */
  BATTERY: protocol.telemetry.paramIds.battery,
} as const;

/**
 * Param IDs the protocol data lists as two bytes wide.
 *
 * @deprecated Kept for consumers that already read it. The decoder sizes
 * every reported value from {@link ParameterCatalog}, which carries a width
 * for each register and states the report direction where it differs.
 */
export const Uint16ParamIds: ReadonlySet<string> = new Set(protocol.telemetry.uint16ParamIds ?? []);

/**
 * Generated parameter catalog. Keyed by `wireLE` (the form inbound parameter
 * reports match against). Each entry carries `paramId`, `name`, `wireBE`,
 * `wireLE`, `valueType`, `valueWidth`, `unit`, `register`, `validation`, plus
 * `reportValueType` / `reportValueWidth` for the registers the device reports
 * differently from how it accepts them.
 *
 * This is the width source every inbound parameter decode reads. A register
 * missing from it has no width, and the decode stops there rather than
 * assuming one.
 *
 * Empty record on older protocol-data versions.
 */
export const ParameterCatalog: Readonly<
  Record<string, NonNullable<ProtocolData['telemetry']['parameterCatalog']>[string]>
> = protocol.telemetry.parameterCatalog ?? {};

/**
 * Training mode values from protocol.json.
 * These map to the TrainingMode enum values.
 */
export const TrainingModeValues = protocol.telemetry.trainingModes;
