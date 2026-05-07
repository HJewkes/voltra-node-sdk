/**
 * Telemetry Decoder
 *
 * Low-level protocol decoder for Voltra BLE telemetry notifications.
 * Only handles parsing bytes into typed data - no business logic.
 * Uses offset-based lookups from protocol.json - no hardcoded byte positions.
 */

import {
  MessageTypes,
  VendorMessages,
  matchesVendorSubType,
  TelemetryOffsets,
  MovementPhase,
  NotificationConfigs,
  ParamIdHex,
  Uint16ParamIds,
  TrainingMode,
  VALID_TRAINING_MODES,
  VendorSchemaVersion,
} from './constants';
import { createFrame, type TelemetryFrame } from '../models/telemetry/frame';
import { bytesEqual, bytesToHex } from '../../shared/utils';
import type { Cmd0x0FBulkResponse, DeviceSettings } from './types';
import type { PerRepEvent, SummaryEvent, PreSummaryEvent, InProgressEvent } from '../../sdk/types';

// =============================================================================
// Param ID constants
// =============================================================================

/**
 * Param ID for damperLevel (0x0351, stored little-endian as `5103`).
 *
 * Phase-5 Block F (handoff 2026-05-06) identified damperLevel as one of the
 * ~9 registers in the settingsUpdate curated subset. Hardcoded here pending
 * a future regen sync that promotes it into `protocol.telemetry.paramIds`.
 */
const DAMPER_LEVEL_PARAM_ID_HEX = '5103';

// <Bug-17> Begin — cmd=0x0F bulk-read response framing constants.
/** Frame-type byte for device-originated response frames (`0x08`). */
const RESPONSE_FRAME_TYPE = 0x08;
/** Extended-length variant of {@link RESPONSE_FRAME_TYPE} (`0x09`). */
const RESPONSE_FRAME_TYPE_EXTENDED = 0x09;
/** Frame offset of the cmd byte in a `0x55`-framed response. */
const CMD_BYTE_OFFSET = 10;
/** cmd byte for the multi-paramID read response (`0x0F`). */
const CMD_PARAM_READ = 0x0f;
/** Frame offset of the param-count u16 LE in a cmd=0x0F response. */
const CMD_0F_COUNT_OFFSET = 12;
/** Frame offset of the first param pair in a cmd=0x0F response. */
const CMD_0F_FIRST_PARAM_OFFSET = 14;

/**
 * Per-paramId value width (bytes) for params decoded from cmd=0x0F bulk
 * responses. Only the params surfaced through `DeviceSettings` are listed —
 * the decoder uses {@link Uint16ParamIds} for everything else, falling back
 * to abort decoding if neither table covers the paramId. Bootstrap step 10
 * (18-param query) covers all of these plus QUICK_CABLE_ADJUSTMENT (`bc54`)
 * whose width is not yet documented; see
 * `voltra-private/research/data-port-2026-05-07-android-deep.md` § 4 #11.
 *
 * Param IDs are stored as little-endian hex strings to match `ParamIdHex`.
 */
const CMD_0F_KNOWN_PARAM_WIDTHS: Readonly<Record<string, number>> = {
  // Step-10 response carries these as uint16 LE (lb / index / state).
  '863e': 2, // BP_BASE_WEIGHT
  '873e': 2, // BP_CHAINS_WEIGHT
  '883e': 2, // BP_ECCENTRIC_WEIGHT (signed; readCmd0x0FValue handles sign)
  '893e': 2, // BP_SET_FITNESS_MODE (also covered by Uint16ParamIds)
  '823e': 2, // BP_RUNTIME_POSITION_CM
  '6a50': 2, // MC_DEFAULT_OFFLEN_CM
  '6253': 2, // RESISTANCE_BAND_MAX_FORCE
  b753: 2, // RESISTANCE_BAND_LEN
  '3154': 2, // ISOMETRIC_MAX_FORCE
  d253: 2, // ISOMETRIC_MAX_DURATION
  // Step-10 response carries these as uint8 flags / enums.
  '6153': 1, // RESISTANCE_BAND_ALGORITHM
  b653: 1, // RESISTANCE_BAND_LEN_BY_ROM
  e352: 1, // EP_RESISTANCE_BAND_INVERSE
  '0651': 1, // FITNESS_ASSIST_MODE
  b053: 1, // FITNESS_INVERSE_CHAIN
  c653: 1, // WEIGHT_TRAINING_EXTRA_MODE
  b04f: 1, // FITNESS_WORKOUT_STATE (training mode)
  // damperLevel
  '5103': 1, // FITNESS_DAMPER_RATIO_IDX
};
// <Bug-17> End

// =============================================================================
// Byte Parsing Helpers
// =============================================================================

/**
 * Read a little-endian uint16 from a Uint8Array.
 */
function readUint16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

/**
 * Read a little-endian uint32 from a Uint8Array.
 */
function readUint32LE(data: Uint8Array, offset: number): number {
  // `>>> 0` keeps the result an unsigned 32-bit integer.
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

/**
 * Read a little-endian int16 from a Uint8Array.
 */
function readInt16LE(data: Uint8Array, offset: number): number {
  const value = readUint16LE(data, offset);
  return value > 0x7fff ? value - 0x10000 : value;
}

/**
 * Write a little-endian uint16 to a Uint8Array.
 */
function writeUint16LE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >> 8) & 0xff;
}

/**
 * Write a little-endian int16 to a Uint8Array.
 */
function writeInt16LE(data: Uint8Array, offset: number, value: number): void {
  if (value < 0) {
    value = value + 0x10000;
  }
  writeUint16LE(data, offset, value);
}

// =============================================================================
// Message Types
// =============================================================================

/**
 * Types of messages that can be decoded.
 *
 * The 0.6.0 release renamed the legacy `'rep_summary'` / `'set_summary'`
 * aliases (left over from the pre-vendor-sub-type era) to clearer
 * `'vendor_per_rep'` / `'vendor_in_progress'` strings, and added
 * `'vendor_summary'` / `'vendor_pre_summary'` for the two end-of-set
 * vendor frames the SDK now decodes.
 */
export type MessageType =
  | 'telemetry_stream'
  | 'vendor_per_rep'
  | 'vendor_in_progress'
  | 'vendor_summary'
  | 'vendor_pre_summary'
  | 'status_update'
  | 'mode_confirmation'
  | 'multi_param'
  | 'settings_update'
  // <Bug-17> cmd=0x0F bulk-read response (e.g. bootstrap step 10).
  | 'cmd_0f_bulk_response'
  | 'device_init'
  | 'unknown';

/**
 * Identify the message type from raw bytes.
 * Uses header matching from protocol.json configurations.
 */
export function identifyMessageType(data: Uint8Array): MessageType {
  if (data.length < 4) return 'unknown';

  const msgType = data.slice(0, 4);

  if (bytesEqual(msgType, MessageTypes.TELEMETRY_STREAM)) {
    return 'telemetry_stream';
  }

  // Vendor sub-type classification. Phase A on-device validation
  // (2026-05-05, 1369 frames) confirmed that perRep frames alias the
  // legacy 4-byte repSummary header and inProgress frames alias the
  // legacy 4-byte setSummary header. 2026-05-06 expanded coverage to
  // `summary` and `preSummary`.
  if (matchesVendorSubType(data, VendorMessages.subTypes.perRep)) {
    return 'vendor_per_rep';
  } else if (matchesVendorSubType(data, VendorMessages.subTypes.inProgress)) {
    return 'vendor_in_progress';
  } else if (matchesVendorSubType(data, VendorMessages.subTypes.summary)) {
    return 'vendor_summary';
  } else if (matchesVendorSubType(data, VendorMessages.subTypes.preSummary)) {
    return 'vendor_pre_summary';
  }

  // <Bug-17> cmd=0x0F bulk-read response: matched on frame-type byte
  // (0x08 or extended 0x09) AND cmd byte (0x0f). Tested before the 2-byte
  // header dispatch because cmd=0x0F response length varies (depends on
  // param count + value widths) and therefore cannot use a fixed-length
  // 2-byte header match.
  if (isCmd0x0FResponse(data)) {
    return 'cmd_0f_bulk_response';
  }

  // Check 2-byte headers for other notification types
  const header2 = bytesToHex(data.slice(0, 2));

  if (header2 === NotificationConfigs.modeConfirmation.header) {
    return 'mode_confirmation';
  } else if (header2 === NotificationConfigs.multiParam.header) {
    return 'multi_param';
  } else if (header2 === NotificationConfigs.settingsUpdate.header) {
    return 'settings_update';
  } else if (header2 === NotificationConfigs.deviceInit.header) {
    return 'device_init';
  } else if (header2 === NotificationConfigs.statusBattery.header) {
    // Phase A confirmed the legacy 4-byte STATUS_UPDATE signature
    // (553404ac) was an alias for this 2-byte path.
    return 'status_update';
  }

  return 'unknown';
}

// =============================================================================
// Decode Results
// =============================================================================

/**
 * Result of decoding a telemetry notification.
 *
 * 0.6.0 dropped the legacy `'rep_boundary'` / `'set_boundary'` variants —
 * vendor-frame decode failures now collapse into `'unknown'` rather than
 * downgrading to the payload-less boundary types.
 */
export type DecodeResult =
  | { type: 'frame'; frame: TelemetryFrame }
  | { type: 'perRep'; event: PerRepEvent } // Typed perRep frame (0.6.0+)
  | { type: 'summary'; event: SummaryEvent } // Typed end-of-set summary (0.6.0+)
  | { type: 'preSummary'; event: PreSummaryEvent } // Typed pre-summary (0.6.0+)
  | { type: 'inProgress'; event: InProgressEvent } // Typed in-progress heartbeat (0.6.0+)
  | { type: 'mode_confirmation'; mode: TrainingMode } // Mode change confirmed
  | { type: 'settings_update'; settings: DeviceSettings } // Device settings
  | { type: 'device_status'; battery: number } // Battery/status update
  | { type: 'unknown'; data: Uint8Array } // Unknown notification with raw data
  | null;

// =============================================================================
// Decoder
// =============================================================================

/**
 * Decode a telemetry stream message into a TelemetryFrame.
 */
export function decodeTelemetryFrame(data: Uint8Array): TelemetryFrame | null {
  if (data.length < 30) {
    return null;
  }

  // Sequence number
  const sequence = readUint16LE(data, TelemetryOffsets.SEQUENCE);

  // Phase
  const phaseByte = data[TelemetryOffsets.PHASE];
  let phase: MovementPhase;
  if (phaseByte >= 0 && phaseByte <= 3) {
    phase = phaseByte as MovementPhase;
  } else {
    phase = MovementPhase.UNKNOWN;
  }

  // Sensor data
  // Force is uint16 (tenths of pounds, always non-negative).
  // Velocity is int16 (mm/s, sign flips with direction: eccentric/return is negative).
  const position = readUint16LE(data, TelemetryOffsets.POSITION);
  const force = readUint16LE(data, TelemetryOffsets.FORCE);
  const velocity = readInt16LE(data, TelemetryOffsets.VELOCITY);

  return createFrame(sequence, phase, position, force, velocity);
}

// =============================================================================
// Vendor frame decoders (0.6.0+)
//
// Field offsets validated 2026-05-06 on VTR-212006 (voltra-private phase-5
// captures). For perRep / summary / preSummary we read offsets from the
// regen's `fields` block — keeping the SDK in sync with voltra-private's
// validation work without recompiling.
// =============================================================================

/**
 * Frame offset = `cmdByteOffset + 1 + payloadOffset` (the cmd marker byte
 * itself sits at `cmdByteOffset`; payload offsets are 0-indexed AFTER it).
 */
function frameOffsetOf(payloadOffset: number): number {
  return VendorMessages.cmdByteOffset + 1 + payloadOffset;
}

/**
 * Decode a vendor `perRep` frame (74 B, fires 2× per rep).
 *
 * Returns `null` if the buffer does not match the perRep sub-type or is
 * shorter than the configured `frameLength`.
 */
export function decodeVendorPerRep(data: Uint8Array): PerRepEvent | null {
  const cfg = VendorMessages.subTypes.perRep;
  if (!matchesVendorSubType(data, cfg)) return null;
  if (cfg.frameLength != null && data.length < cfg.frameLength) return null;
  if (!cfg.fields) return null;

  const motionPhaseByte = data[frameOffsetOf(cfg.fields.motionPhase.payloadOffset)];
  // Anything other than the documented `pull` (1) / `return` (2) values would
  // be an unexpected device state — fall back to 'pull' rather than throwing.
  const phase: 'pull' | 'return' = motionPhaseByte === 2 ? 'return' : 'pull';

  return {
    phase,
    frameCounter: data[frameOffsetOf(cfg.fields.frameCounter.payloadOffset)],
    setCounter: data[frameOffsetOf(cfg.fields.setCounter.payloadOffset)],
    repCount: data[frameOffsetOf(cfg.fields.repCount.payloadOffset)],
    targetWeightTenths: readUint16LE(
      data,
      frameOffsetOf(cfg.fields.targetWeightTenths.payloadOffset)
    ),
  };
}

/**
 * Decode a vendor `summary` frame (140 B, end-of-set).
 *
 * Mode-specific aggregate fields beyond `setCounter` / `repCount` are not
 * decoded — consumers needing those should read from `event.raw`.
 */
export function decodeVendorSummary(data: Uint8Array): SummaryEvent | null {
  const cfg = VendorMessages.subTypes.summary;
  if (!matchesVendorSubType(data, cfg)) return null;
  if (cfg.frameLength != null && data.length < cfg.frameLength) return null;
  if (!cfg.fields || cfg.schemaVersionByteOffset === undefined) return null;

  const schemaVersionByte = data[frameOffsetOf(cfg.schemaVersionByteOffset)];

  return {
    schemaVersion: schemaVersionByte as VendorSchemaVersion,
    setCounter: data[frameOffsetOf(cfg.fields.setCounter.payloadOffset)],
    repCount: readUint16LE(data, frameOffsetOf(cfg.fields.repCount.payloadOffset)),
    raw: data.slice(),
  };
}

/**
 * Decode a vendor `preSummary` frame (110 B, fires ~3s before final rep).
 */
export function decodeVendorPreSummary(data: Uint8Array): PreSummaryEvent | null {
  const cfg = VendorMessages.subTypes.preSummary;
  if (!matchesVendorSubType(data, cfg)) return null;
  if (cfg.frameLength != null && data.length < cfg.frameLength) return null;
  if (!cfg.fields || cfg.schemaVersionByteOffset === undefined) return null;

  const schemaVersionByte = data[frameOffsetOf(cfg.schemaVersionByteOffset)];

  return {
    schemaVersion: schemaVersionByte as VendorSchemaVersion,
    targetWeightTenths: readUint16LE(
      data,
      frameOffsetOf(cfg.fields.targetWeightTenths.payloadOffset)
    ),
    repCount: readUint16LE(data, frameOffsetOf(cfg.fields.repCount.payloadOffset)),
    repDurationMs: readUint32LE(data, frameOffsetOf(cfg.fields.repDurationMs.payloadOffset)),
    raw: data.slice(),
  };
}

// inProgress field offsets are validated empirically (handoff 2026-05-06)
// but not yet baked into voltra-private's telemetry-config; hardcoded here
// pending a future regen sync.
const IN_PROGRESS_PEAK_FORCE_OFFSET = 17;
const IN_PROGRESS_CURRENT_FORCE_OFFSET = 25;
const IN_PROGRESS_VELOCITY_OFFSET = 28;
const IN_PROGRESS_TARGET_WEIGHT_OFFSET = 49;
const IN_PROGRESS_FRAME_LENGTH = 79;

/**
 * Decode a vendor `inProgress` frame (79 B, ~1 Hz heartbeat).
 *
 * Field offsets are hardcoded — the regen's `fields` block is empty for
 * inProgress (`fieldsValidated: false`).
 */
export function decodeVendorInProgress(data: Uint8Array): InProgressEvent | null {
  const cfg = VendorMessages.subTypes.inProgress;
  if (!matchesVendorSubType(data, cfg)) return null;
  const minLength = cfg.frameLength ?? IN_PROGRESS_FRAME_LENGTH;
  if (data.length < minLength) return null;

  return {
    peakForceTenths: readUint16LE(data, IN_PROGRESS_PEAK_FORCE_OFFSET),
    currentForceTenths: readUint16LE(data, IN_PROGRESS_CURRENT_FORCE_OFFSET),
    velocityCmPerSec: readUint16LE(data, IN_PROGRESS_VELOCITY_OFFSET),
    targetWeightTenths: readUint32LE(data, IN_PROGRESS_TARGET_WEIGHT_OFFSET),
    raw: data.slice(),
  };
}

/**
 * Decode a mode confirmation notification.
 * Returns the training mode value.
 */
function decodeModeConfirmation(data: Uint8Array): DecodeResult {
  const config = NotificationConfigs.modeConfirmation;
  if (config.length && data.length < config.length) return null;
  if (config.valueOffset === undefined) return null;

  const rawMode = data[config.valueOffset];
  const mode = VALID_TRAINING_MODES.includes(rawMode as TrainingMode)
    ? (rawMode as TrainingMode)
    : TrainingMode.Idle;
  return { type: 'mode_confirmation', mode };
}

/**
 * Decode a settings update or multi-param notification.
 * Handles mixed-size value fields: param IDs in Uint16ParamIds get 2-byte
 * (uint16 LE) values; all others get 1-byte (uint8) values.
 */
function decodeSettingsUpdate(data: Uint8Array): DecodeResult {
  const config = NotificationConfigs.settingsUpdate;
  if (config.paramCountOffset === undefined || config.firstParamOffset === undefined) {
    return null;
  }

  const settings: DeviceSettings = {};
  const paramCount = data[config.paramCountOffset];
  let offset = config.firstParamOffset;

  for (let i = 0; i < paramCount && i < 9; i++) {
    if (offset + 2 > data.length) break;

    const paramIdHex = bytesToHex(data.slice(offset, offset + 2));
    offset += 2;

    let value: number;
    if (Uint16ParamIds.has(paramIdHex)) {
      if (offset + 2 > data.length) break;
      value = readUint16LE(data, offset);
      offset += 2;
    } else {
      if (offset + 1 > data.length) break;
      value = data[offset];
      offset += 1;
    }

    if (paramIdHex === ParamIdHex.BASE_WEIGHT) {
      settings.baseWeight = value;
    } else if (paramIdHex === ParamIdHex.CHAINS) {
      settings.chains = value;
    } else if (paramIdHex === ParamIdHex.ECCENTRIC) {
      settings.eccentric = value;
    } else if (paramIdHex === ParamIdHex.TRAINING_MODE) {
      settings.trainingMode = VALID_TRAINING_MODES.includes(value as TrainingMode)
        ? (value as TrainingMode)
        : undefined;
    } else if (paramIdHex === ParamIdHex.INVERSE_CHAINS) {
      settings.inverseChains = value;
    } else if (paramIdHex === DAMPER_LEVEL_PARAM_ID_HEX) {
      // damperLevel uses uint8 value (opcode 0xc7). Phase-5 Block F
      // confirmed damperLevel is one of the ~9 registers reflected in the
      // settingsUpdate curated subset.
      settings.damperLevel = value;
    }
  }

  return { type: 'settings_update', settings };
}

// <Bug-17> Begin — cmd=0x0F bulk-read response classification + decode.
/**
 * Returns true when `data` looks like a cmd=0x0F bulk-read response. Matches
 * the frame-type byte (0x08 / 0x09) and the cmd byte (0x0F) at their
 * documented offsets. Bootstrap step 10's response is the canonical instance.
 */
function isCmd0x0FResponse(data: Uint8Array): boolean {
  if (data.length <= CMD_BYTE_OFFSET) return false;
  if (data[0] !== 0x55) return false;
  const frameType = data[2];
  if (frameType !== RESPONSE_FRAME_TYPE && frameType !== RESPONSE_FRAME_TYPE_EXTENDED) {
    return false;
  }
  return data[CMD_BYTE_OFFSET] === CMD_PARAM_READ;
}

/**
 * Resolve the wire width (in bytes) of a paramId's value field in a cmd=0x0F
 * response, or `null` if the SDK does not model this paramId yet. Falls back
 * to {@link Uint16ParamIds} for params present in `protocol.json`.
 */
function resolveCmd0x0FValueWidth(paramIdHex: string): number | null {
  const known = CMD_0F_KNOWN_PARAM_WIDTHS[paramIdHex];
  if (known !== undefined) return known;
  if (Uint16ParamIds.has(paramIdHex)) return 2;
  return null;
}

/** Read a value of the given width and apply paramId-specific signedness. */
function readCmd0x0FValue(
  data: Uint8Array,
  offset: number,
  width: number,
  paramIdHex: string
): number {
  if (width === 1) return data[offset];
  if (width === 2) {
    // BP_ECCENTRIC_WEIGHT (0x3e88, LE `883e`) is signed lb on the wire.
    if (paramIdHex === ParamIdHex.ECCENTRIC) return readInt16LE(data, offset);
    return readUint16LE(data, offset);
  }
  // Width 4 / other widths are not currently resolved by
  // resolveCmd0x0FValueWidth, so this branch is unreachable today. Kept as
  // a defensive default to avoid misreporting partial values.
  return readUint32LE(data, offset);
}

/**
 * Mutate `settings` to reflect the given paramId+value, mirroring
 * {@link decodeSettingsUpdate}'s curated subset (baseWeight / chains /
 * eccentric / trainingMode / inverseChains / damperLevel). Unmapped params
 * are intentionally ignored.
 */
function applyCmd0x0FParamToSettings(
  settings: DeviceSettings,
  paramIdHex: string,
  value: number
): void {
  if (paramIdHex === ParamIdHex.BASE_WEIGHT) {
    settings.baseWeight = value;
  } else if (paramIdHex === ParamIdHex.CHAINS) {
    settings.chains = value;
  } else if (paramIdHex === ParamIdHex.ECCENTRIC) {
    settings.eccentric = value;
  } else if (paramIdHex === ParamIdHex.TRAINING_MODE) {
    settings.trainingMode = VALID_TRAINING_MODES.includes(value as TrainingMode)
      ? (value as TrainingMode)
      : undefined;
  } else if (paramIdHex === ParamIdHex.INVERSE_CHAINS) {
    settings.inverseChains = value;
  } else if (paramIdHex === DAMPER_LEVEL_PARAM_ID_HEX) {
    settings.damperLevel = value;
  }
}

/**
 * Decode a cmd=0x0F bulk-read response into a {@link Cmd0x0FBulkResponse}.
 *
 * Walks the `[count, ...(paramId + value)]` payload using
 * {@link CMD_0F_KNOWN_PARAM_WIDTHS} to size each value. Stops gracefully
 * (returning whatever has been decoded so far) on the first param whose
 * width is not in the known-widths table — this keeps mis-aligned reads
 * from corrupting downstream offsets when the device echoes a register the
 * SDK does not yet model.
 *
 * Returns `null` only if the buffer fails the frame-type / cmd-byte gate.
 */
export function decodeCmd0x0FResponse(data: Uint8Array): Cmd0x0FBulkResponse | null {
  if (!isCmd0x0FResponse(data)) return null;
  if (data.length < CMD_0F_FIRST_PARAM_OFFSET) return null;

  const declaredCount = readUint16LE(data, CMD_0F_COUNT_OFFSET);
  const settings: DeviceSettings = {};
  let offset = CMD_0F_FIRST_PARAM_OFFSET;
  let decoded = 0;

  for (let i = 0; i < declaredCount; i++) {
    if (offset + 2 > data.length) break;
    const paramIdHex = bytesToHex(data.slice(offset, offset + 2));
    offset += 2;

    const width = resolveCmd0x0FValueWidth(paramIdHex);
    if (width === null) break;
    if (offset + width > data.length) break;

    const value = readCmd0x0FValue(data, offset, width, paramIdHex);
    offset += width;
    decoded++;

    applyCmd0x0FParamToSettings(settings, paramIdHex, value);
  }

  return { paramCount: decoded, settings };
}
// <Bug-17> End

/**
 * Decode a device status notification.
 * Extracts battery level.
 */
function decodeDeviceStatus(data: Uint8Array): DecodeResult {
  // Try device init format first
  const initConfig = NotificationConfigs.deviceInit;
  if (
    initConfig.length &&
    data.length >= initConfig.length &&
    initConfig.batteryOffset !== undefined
  ) {
    const header = bytesToHex(data.slice(0, 2));
    if (header === initConfig.header) {
      const battery = data[initConfig.batteryOffset];
      return { type: 'device_status', battery };
    }
  }

  // Try status/battery format
  const statusConfig = NotificationConfigs.statusBattery;
  if (
    statusConfig.length &&
    data.length >= statusConfig.length &&
    statusConfig.batteryOffset !== undefined
  ) {
    const header = bytesToHex(data.slice(0, 2));
    if (header === statusConfig.header) {
      const battery = data[statusConfig.batteryOffset];
      return { type: 'device_status', battery };
    }
  }

  // Fallback: return unknown with raw data
  return { type: 'unknown', data };
}

/**
 * Decode a BLE notification.
 * Returns structured data based on message type.
 */
export function decodeNotification(data: Uint8Array): DecodeResult {
  const msgType = identifyMessageType(data);

  switch (msgType) {
    case 'telemetry_stream': {
      const frame = decodeTelemetryFrame(data);
      return frame ? { type: 'frame', frame } : null;
    }

    case 'vendor_per_rep': {
      // 0.6.0 dropped the legacy rep_boundary fallback. Truncated or otherwise
      // unparseable vendor frames now surface as 'unknown' rather than silently
      // downgrading.
      const event = decodeVendorPerRep(data);
      return event ? { type: 'perRep', event } : { type: 'unknown', data };
    }

    case 'vendor_in_progress': {
      const event = decodeVendorInProgress(data);
      return event ? { type: 'inProgress', event } : { type: 'unknown', data };
    }

    case 'vendor_summary': {
      const event = decodeVendorSummary(data);
      return event ? { type: 'summary', event } : { type: 'unknown', data };
    }

    case 'vendor_pre_summary': {
      const event = decodeVendorPreSummary(data);
      return event ? { type: 'preSummary', event } : { type: 'unknown', data };
    }

    case 'mode_confirmation':
      return decodeModeConfirmation(data);

    case 'settings_update':
    case 'multi_param':
      return decodeSettingsUpdate(data);

    case 'cmd_0f_bulk_response': {
      // <Bug-17> Reuse the `settings_update` dispatch path so existing
      // `onSettingsUpdate` listeners (and `syncSettingsFromDevice`) populate
      // `_settings` automatically — the bulk response carries the same
      // DeviceSettings shape as an async cmd=0x10 update.
      const decoded = decodeCmd0x0FResponse(data);
      return decoded ? { type: 'settings_update', settings: decoded.settings } : null;
    }

    case 'device_init':
    case 'status_update':
      return decodeDeviceStatus(data);

    default:
      return { type: 'unknown', data };
  }
}

// =============================================================================
// Encoder (for replay)
// =============================================================================

/**
 * Encode a TelemetryFrame into a BLE notification payload.
 * Creates a minimal 30-byte message that can be decoded by decodeTelemetryFrame.
 * Used for replay functionality.
 */
export function encodeTelemetryFrame(frame: TelemetryFrame): Uint8Array {
  const data = new Uint8Array(30);

  // Message type header (telemetry stream)
  const header = MessageTypes.TELEMETRY_STREAM;
  data[0] = header[0];
  data[1] = header[1];
  data[2] = header[2];
  data[3] = header[3];

  // Sequence (bytes 6-7)
  writeUint16LE(data, TelemetryOffsets.SEQUENCE, frame.sequence);

  // Phase (byte 13)
  data[TelemetryOffsets.PHASE] = frame.phase;

  // Position (bytes 24-25, unsigned)
  writeUint16LE(data, TelemetryOffsets.POSITION, frame.position);

  // Force (bytes 26-27, unsigned tenths of pounds)
  writeUint16LE(data, TelemetryOffsets.FORCE, frame.force);

  // Velocity (bytes 28-29, signed — sign flips with direction)
  writeInt16LE(data, TelemetryOffsets.VELOCITY, frame.velocity);

  return data;
}
