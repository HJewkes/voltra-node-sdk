/**
 * Telemetry Decoder
 *
 * Low-level protocol decoder for Voltra BLE telemetry notifications.
 * Only handles parsing bytes into typed data - no business logic.
 * Uses offset-based lookups from protocol.json - no hardcoded byte positions.
 */

import protocolData from './data/protocol-data.generated';
import {
  MessageTypes,
  VendorMessages,
  matchesVendorSubType,
  TelemetryOffsets,
  MovementPhase,
  NotificationConfigs,
  ParamIdHex,
  TrainingMode,
  VALID_TRAINING_MODES,
  VendorSchemaVersion,
} from './constants';
import { decodeParameterReport, resolveReportWidth } from './parameter-report';
import type { ParameterReportLayout } from './parameter-report';
import { createFrame, type TelemetryFrame } from '../models/telemetry/frame';
import { classifyMotorReport, MOTOR_STATE_FIELD } from './device-state';
import { FRAME_MARKER, sealEnvelope } from './frame-envelope';
import { bytesEqual, bytesToHex, hexToBytes } from '../../shared/utils';
import type {
  BulkParamResponse,
  DeviceSettings,
  ProtocolData,
  StateDumpEvent,
  RowingRuntimeEvent,
  IsometricSummaryEvent,
  WaveformChunkEvent,
  AsyncStateFrame,
  AsyncStateParam,
} from './types';
import type { PerRepEvent, SummaryEvent, SetSummaryEvent, InProgressEvent } from '../../sdk/types';

/**
 * Descriptor for the device's own reply to the handshake finish (VW-403).
 * Absent on protocol data older than the group that introduced it, in which
 * case no frame is ever classified as an acceptance report.
 */
const ACCEPTANCE_REPORT = (protocolData as ProtocolData).telemetry.acceptanceReport;

// <Decoder-statedump-asyncstate> ==========================================================
// Frame-byte offsets and constants for the async-state and state-dump
// decode paths.
// All other frame types continue to flow through the legacy header-based
// dispatch in `identifyMessageType`.
// ==========================================================
/** Frame offset of the cmd byte — matches `VendorMessages.cmdByteOffset`. */
const CMD_BYTE_OFFSET = 10;
/** Cmd byte identifying an async-state frame. */
const CMD_ASYNC_STATE = 0x10;
/** Offset of the inner-cmd discriminator, which doubles as the param count. */
const ASYNC_STATE_PARAM_COUNT_OFFSET = 11;
/** Offset of the first param; the byte before it is reserved and always zero. */
const ASYNC_STATE_FIRST_PARAM_OFFSET = 13;
/**
 * Sub-type bytes of the state-dump frame. Its frame header
 * aliases the legacy
 * `statusBattery` notification length, so this dispatch must precede the
 * header check.
 */
const STATE_DUMP_SUBTYPE_0: number = 0x80;
const STATE_DUMP_SUBTYPE_1: number = 0x25;
/** Total length of the state-dump frame (envelope + payload + CRC). */
const STATE_DUMP_FRAME_LENGTH = 52;
/** Waveform-chunk sub-type marker (see types.ts comments). */
const WAVEFORM_SUBTYPE_0 = 0x93;
/**
 * Variant markers for the waveform-chunk family. The first is the
 * isometric-mode marker; the other two are observed on-device and may carry
 * rowing waveform data.
 */
const WAVEFORM_VARIANT_MARKERS: ReadonlySet<number> = new Set([0xcc, 0x82, 0xa8]);

// <Bug-17> Begin — bulk-read response framing constants.
/** Frame-type byte for device-originated response frames. */
const RESPONSE_FRAME_TYPE = 0x08;
/** Extended-length variant of {@link RESPONSE_FRAME_TYPE}. */
const RESPONSE_FRAME_TYPE_EXTENDED = 0x09;
/** Cmd byte for the multi-paramID read response. */
const CMD_PARAM_READ = 0x0f;
/** Frame offset of the byte saying whether the device honoured the read. */
const BULK_PARAM_RESULT_OFFSET = 11;
/** Frame offset of the param-count u16 LE in a bulk-read response. */
const BULK_PARAM_COUNT_OFFSET = 12;
/** Frame offset of the first param pair in a bulk-read response. */
const BULK_PARAM_FIRST_OFFSET = 14;

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
 * `'vendor_summary'` / `'vendor_set_summary'` for the workout-end and
 * per-set vendor frames the SDK now decodes (the latter renamed from
 * `'vendor_pre_summary'` in 0.9.0).
 */
export type MessageType =
  | 'telemetry_stream'
  | 'vendor_per_rep'
  | 'vendor_in_progress'
  | 'vendor_summary'
  | 'vendor_set_summary'
  // <Decoder-statedump-asyncstate>
  | 'vendor_state_dump'
  | 'vendor_rowing_runtime'
  | 'vendor_isometric_summary'
  | 'vendor_waveform_chunk'
  // eslint-disable-next-line voltras/no-private-provenance -- exported `MessageType` member; renaming it is a breaking API change (VW-214, see CONTRIBUTING.md)
  | 'cmd10_async_state'
  | 'status_update'
  | 'mode_confirmation'
  | 'multi_param'
  | 'settings_update'
  // <Bug-17> bulk-read response (e.g. bootstrap step 10).
  // eslint-disable-next-line voltras/no-private-provenance -- exported `MessageType` member; renaming it is a breaking API change (VW-214, see CONTRIBUTING.md)
  | 'cmd_0f_bulk_response'
  | 'device_init'
  | 'connection_acceptance'
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

  // Vendor sub-type classification. On-device validation (2026-05-05, 1369
  // frames) confirmed that perRep frames alias the legacy repSummary header
  // and inProgress frames alias the legacy setSummary header. 2026-05-06
  // expanded coverage to `summary` and `setSummary` (the per-set close
  // marker; renamed from `preSummary` in 0.9.0).
  if (matchesVendorSubType(data, VendorMessages.subTypes.perRep)) {
    return 'vendor_per_rep';
  } else if (matchesVendorSubType(data, VendorMessages.subTypes.inProgress)) {
    return 'vendor_in_progress';
  } else if (matchesVendorSubType(data, VendorMessages.subTypes.summary)) {
    return 'vendor_summary';
  } else if (matchesVendorSubType(data, VendorMessages.subTypes.setSummary)) {
    return 'vendor_set_summary';
  }

  if (isAcceptanceReport(data)) {
    return 'connection_acceptance';
  }

  // <Bug-17> bulk-read response: matched on the frame-type byte
  // (plain or extended) AND the cmd byte. Tested before the header
  // dispatch because this response's length varies with param count and
  // value widths, so it cannot use a fixed-length header match.
  if (isBulkParamResponse(data)) {
    // eslint-disable-next-line voltras/no-private-provenance -- exported `MessageType` member; renaming it is a breaking API change (VW-214, see CONTRIBUTING.md)
    return 'cmd_0f_bulk_response';
  }

  // <Decoder-statedump-asyncstate> Vendor state-dump and rowing telemetry sub-types.
  // These checks must precede the header dispatch — the state-dump
  // frame aliases the `statusBattery` header and was previously yielding
  // spurious battery readings.
  // Identified by its own bytes, never by its length: a family a frame
  // belongs to cannot depend on how much of it arrived. A frame too short to
  // decode fails in the decoder, where the length actually matters.
  if (
    data[CMD_BYTE_OFFSET] === VendorMessages.cmdValue &&
    data[CMD_BYTE_OFFSET + 1] === STATE_DUMP_SUBTYPE_0 &&
    data[CMD_BYTE_OFFSET + 2] === STATE_DUMP_SUBTYPE_1
  ) {
    return 'vendor_state_dump';
  }
  if (matchesVendorSubType(data, VendorMessages.subTypes.rowingRuntime)) {
    return 'vendor_rowing_runtime';
  }
  if (matchesVendorSubType(data, VendorMessages.subTypes.isometricSummary)) {
    return 'vendor_isometric_summary';
  }
  if (
    data[CMD_BYTE_OFFSET] === VendorMessages.cmdValue &&
    data[CMD_BYTE_OFFSET + 1] === WAVEFORM_SUBTYPE_0 &&
    WAVEFORM_VARIANT_MARKERS.has(data[CMD_BYTE_OFFSET + 2])
  ) {
    return 'vendor_waveform_chunk';
  }

  // <Decoder-statedump-asyncstate> Async-state cascade. On-device validation
  // confirmed the "inner-cmd" byte is really the param count, which
  // distinguishes a
  // single-param update from a mode-switch pair and from a full-settings
  // cascade. The legacy header path (`mode_confirmation`,
  // `multi_param`, `settings_update`) mis-classified single-param frames
  // carrying non-trainingMode params (assist, damper, chains) — those now
  // flow through this path.
  if (
    data.length >= ASYNC_STATE_FIRST_PARAM_OFFSET + 3 &&
    data[CMD_BYTE_OFFSET] === CMD_ASYNC_STATE
  ) {
    // eslint-disable-next-line voltras/no-private-provenance -- exported `MessageType` member; renaming it is a breaking API change (VW-214, see CONTRIBUTING.md)
    return 'cmd10_async_state';
  }

  // Check the fixed-length headers for other notification types
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
    // On-device validation confirmed the legacy status signature was an
    // alias for this path.
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
  | { type: 'setSummary'; event: SetSummaryEvent } // Typed per-set summary; renamed from `preSummary` in 0.9.0
  | { type: 'inProgress'; event: InProgressEvent } // Typed in-progress heartbeat (0.6.0+)
  | { type: 'mode_confirmation'; mode: TrainingMode } // Mode change confirmed
  | { type: 'settings_update'; settings: DeviceSettings } // Device settings
  // <Decoder-statedump-asyncstate> State dump + rowing telemetry.
  | { type: 'state_dump'; event: StateDumpEvent }
  | { type: 'rowing_runtime'; event: RowingRuntimeEvent }
  | { type: 'isometric_summary'; event: IsometricSummaryEvent }
  | { type: 'waveform_chunk'; event: WaveformChunkEvent }
  | { type: 'connection_acceptance'; accepted: boolean; status: number } // VW-403
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
  // Position is uint16 (mm, 0=rest).
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
// Field offsets validated on-device 2026-05-06. For perRep / summary /
// setSummary we read offsets from the regen's `fields` block, so a protocol
// refresh does not require recompiling the SDK.
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
    setCounter: readUint16LE(data, frameOffsetOf(cfg.fields.setCounter.payloadOffset)),
    repCount: readUint16LE(data, frameOffsetOf(cfg.fields.repCount.payloadOffset)),
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
    setCounter: readUint16LE(data, frameOffsetOf(cfg.fields.setCounter.payloadOffset)),
    repCount: readUint16LE(data, frameOffsetOf(cfg.fields.repCount.payloadOffset)),
    raw: data.slice(),
  };
}

/**
 * Decode a vendor set-summary frame. Per-set close marker
 * in WT/RB/Damper modes; emitted by the device after all reps complete.
 *
 * Renamed from `decodeVendorPreSummary` in 0.9.0 — the legacy `preSummary`
 * label and "fires before final rep" docstring were misnomers. The frame
 * fires post-final-rep with the device's own debounce.
 */
export function decodeVendorSetSummary(data: Uint8Array): SetSummaryEvent | null {
  const cfg = VendorMessages.subTypes.setSummary;
  if (!matchesVendorSubType(data, cfg)) return null;
  if (cfg.frameLength != null && data.length < cfg.frameLength) return null;
  if (!cfg.fields || cfg.schemaVersionByteOffset === undefined) return null;

  const schemaVersionByte = data[frameOffsetOf(cfg.schemaVersionByteOffset)];

  const fields = cfg.fields;

  return {
    schemaVersion: schemaVersionByte as VendorSchemaVersion,
    targetWeightTenths: readUint16LE(data, frameOffsetOf(fields.targetWeightTenths.payloadOffset)),
    repCount: readUint16LE(data, frameOffsetOf(fields.repCount.payloadOffset)),
    totalPullMovingTimeMs: readUint32LE(
      data,
      frameOffsetOf(fields.totalPullMovingTimeMs.payloadOffset)
    ),
    peakForceTenths: readUint16LE(data, frameOffsetOf(fields.peakForceTenths.payloadOffset)),
    peakPowerRaw: readUint32LE(data, frameOffsetOf(fields.peakPowerRaw.payloadOffset)),
    raw: data.slice(),
  };
}

/**
 * Decode a vendor `inProgress` frame (79 B, ~1 Hz heartbeat).
 *
 * Every field is a per-rep mean the device repeats until the next rep
 * boundary, not a live reading. Offsets come from the generated config.
 */
export function decodeVendorInProgress(data: Uint8Array): InProgressEvent | null {
  const cfg = VendorMessages.subTypes.inProgress;
  if (!matchesVendorSubType(data, cfg)) return null;
  if (cfg.frameLength != null && data.length < cfg.frameLength) return null;
  if (!cfg.fields) return null;
  const fields = cfg.fields;

  return {
    meanPullForceTenths: readUint16LE(
      data,
      frameOffsetOf(fields.meanPullForceTenths.payloadOffset)
    ),
    meanReturnForceTenths: readUint16LE(
      data,
      frameOffsetOf(fields.meanReturnForceTenths.payloadOffset)
    ),
    meanReturnSpeedMmPerSec: readUint16LE(
      data,
      frameOffsetOf(fields.meanReturnSpeedMmPerSec.payloadOffset)
    ),
    pullVolumeRawTenths: readUint32LE(
      data,
      frameOffsetOf(fields.pullVolumeRawTenths.payloadOffset)
    ),
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
 *
 * Same entry list as every other parameter report; only the payload start
 * differs, and it comes from the protocol data rather than from here.
 */
function decodeSettingsUpdate(data: Uint8Array): DecodeResult {
  const config = NotificationConfigs.settingsUpdate;
  if (config.paramCountOffset === undefined || config.firstParamOffset === undefined) {
    return null;
  }

  const report = decodeParameterReport(data, {
    countOffset: config.paramCountOffset,
    firstParamOffset: config.firstParamOffset,
  });
  return { type: 'settings_update', settings: paramsToSettings(report.params) };
}

// <Decoder-statedump-asyncstate> ==========================================================
// Async-state frames.
//
// The device's change report is one shape of parameter report, so the walk
// itself lives in `parameter-report.ts` and this path supplies only where its
// entry list starts.
//
// `decodeAsyncState` returns the structured param list; `decodeAsyncStateToResult`
// tries to project it into a `mode_confirmation` (single TRAINING_MODE
// param) or `settings_update` (any other recognized params). Frames whose
// only param is unrecognized still return `settings_update` with an empty
// settings bag — this is intentional: the bridge can ignore the empty bag
// rather than mis-routing the frame to `unknown`.
// ==========================================================
/** Where the change report keeps its entry list. */
const CHANGE_REPORT_LAYOUT: ParameterReportLayout = {
  countOffset: ASYNC_STATE_PARAM_COUNT_OFFSET,
  firstParamOffset: ASYNC_STATE_FIRST_PARAM_OFFSET,
};

/**
 * Decode the param list of a async-state frame. Stops at the first param
 * whose width the protocol data does not carry, or at a truncated one, and
 * says so through `complete`.
 */
export function decodeAsyncState(data: Uint8Array): AsyncStateFrame | null {
  if (data.length < ASYNC_STATE_FIRST_PARAM_OFFSET + 3) return null;
  if (data[CMD_BYTE_OFFSET] !== CMD_ASYNC_STATE) return null;
  const report = decodeParameterReport(data, CHANGE_REPORT_LAYOUT);
  return {
    paramCount: report.declaredCount,
    params: report.params,
    complete: report.complete,
  };
}

/**
 * Project a decoded param list into a `DeviceSettings` bag.
 *
 * Unrecognized param IDs are skipped silently — they're emitted by the
 * device but not yet plumbed into the public `DeviceSettings` shape.
 */
function paramsToSettings(params: AsyncStateParam[]): DeviceSettings {
  const settings: DeviceSettings = {};
  for (const { paramIdHex, value } of params) {
    applyParamToSettings(settings, paramIdHex, value);
  }
  return settings;
}

/**
 * Mutate `settings` to reflect one reported register. Shared by every
 * parameter-report path so a register reaches the same field whichever
 * shape reported it. Unmapped registers are intentionally ignored.
 */
function applyParamToSettings(settings: DeviceSettings, paramIdHex: string, value: number): void {
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
  } else if (paramIdHex === ParamIdHex.DAMPER_LEVEL) {
    settings.damperLevel = value;
  } else if (paramIdHex === ParamIdHex.BATTERY) {
    settings.battery = value;
  } else if (paramIdHex === MOTOR_STATE_FIELD) {
    settings.motorState = classifyMotorReport(value) ?? undefined;
  }
}

/**
 * Decode a async-state frame to a high-level `DecodeResult`.
 *
 * Single-param frames (paramCount=1) carrying TRAINING_MODE surface as
 * `mode_confirmation`; everything else surfaces as `settings_update` so
 * non-trainingMode single-param frames (assist, damper, chains) are no
 * longer mis-classified as mode changes.
 */
function decodeAsyncStateToResult(data: Uint8Array): DecodeResult {
  const decoded = decodeAsyncState(data);
  if (!decoded) return null;
  if (decoded.params.length === 1 && decoded.params[0].paramIdHex === ParamIdHex.TRAINING_MODE) {
    const value = decoded.params[0].value;
    const mode = VALID_TRAINING_MODES.includes(value as TrainingMode)
      ? (value as TrainingMode)
      : TrainingMode.Idle;
    return { type: 'mode_confirmation', mode };
  }
  return { type: 'settings_update', settings: paramsToSettings(decoded.params) };
}

// =============================================================================
// State-dump decoder
// =============================================================================

/**
 * Decode the vendor state-dump frame.
 *
 * Returns `null` for any frame that doesn't match the sub-type bytes or is
 * shorter than a full state-dump frame. The payload carries runtime state
 * (active training mode, assist toggle, weight, effective chain force,
 * eccentric overload). `event.raw` excludes the CRC trailer.
 *
 * Field offsets are validated on-device (2026-05-07) and fixed: an earlier
 * hypothesis that this frame used a variable layout was disproved.
 */
export function decodeStateDump(data: Uint8Array): StateDumpEvent | null {
  if (data.length < STATE_DUMP_FRAME_LENGTH) return null;
  if (data[CMD_BYTE_OFFSET] !== VendorMessages.cmdValue) return null;
  if (data[CMD_BYTE_OFFSET + 1] !== STATE_DUMP_SUBTYPE_0) return null;
  if (data[CMD_BYTE_OFFSET + 2] !== STATE_DUMP_SUBTYPE_1) return null;

  const payloadStart = CMD_BYTE_OFFSET + 3;
  // Exclude the CRC trailer from raw.
  const payloadEnd = STATE_DUMP_FRAME_LENGTH - 2;
  const raw = data.slice(payloadStart, payloadEnd);

  return {
    trainingMode: raw[0] as TrainingMode,
    assistMode: raw[1],
    weightLbsTenths: readUint16LE(raw, 3),
    chainTargetForceTenths: readUint16LE(raw, 5),
    eccentricPercentTenths: readUint16LE(raw, 7),
    raw,
  };
}

/**
 * Project a state-dump decode into a `settings_update` so the existing
 * bridge subscription path picks up assist / chains-active without a new
 * event channel. The raw event is also exposed via `decodeStateDump`.
 */
function decodeStateDumpToResult(data: Uint8Array): DecodeResult {
  const event = decodeStateDump(data);
  if (!event) return { type: 'unknown', data };
  return { type: 'state_dump', event };
}

// =============================================================================
// Families with no captured frame behind them (see types.ts)
//
// Both decoders hand back raw bytes. Their identifiers come from the vendor
// app's own catalog and nothing else, so parsing a field out of either would
// be inventing a layout rather than reading one.
// =============================================================================

/** Payload bytes of a vendor frame, from the sub-type marker to the CRC. */
function vendorPayload(data: Uint8Array): Uint8Array {
  const payloadStart = CMD_BYTE_OFFSET + 1;
  return data.slice(payloadStart, Math.max(payloadStart, data.length - 2));
}

/**
 * Decode a rowing runtime frame to its raw bytes.
 *
 * Returns `null` for anything that is not this family.
 */
export function decodeRowingRuntime(data: Uint8Array): RowingRuntimeEvent | null {
  if (!matchesVendorSubType(data, VendorMessages.subTypes.rowingRuntime)) return null;
  return { raw: vendorPayload(data) };
}

/**
 * Decode an isometric summary frame to its raw bytes.
 *
 * Returns `null` for anything that is not this family.
 */
export function decodeIsometricSummary(data: Uint8Array): IsometricSummaryEvent | null {
  if (!matchesVendorSubType(data, VendorMessages.subTypes.isometricSummary)) return null;
  return { raw: vendorPayload(data) };
}

/**
 * Decode a waveform chunk frame. The variant byte distinguishes the flows
 * that emit this family. Caller is responsible for assembling chunks across
 * frames using `chunkIndex`.
 *
 * **Sample units:** `tenths-of-pounds`. A consumer wanting newtons scales
 * tenths-of-pounds by 4.4482216.
 */
export function decodeWaveformChunk(data: Uint8Array): WaveformChunkEvent | null {
  if (data[CMD_BYTE_OFFSET] !== VendorMessages.cmdValue) return null;
  if (data[CMD_BYTE_OFFSET + 1] !== WAVEFORM_SUBTYPE_0) return null;
  const variant = data[CMD_BYTE_OFFSET + 2];
  if (!WAVEFORM_VARIANT_MARKERS.has(variant)) return null;

  const payloadStart = CMD_BYTE_OFFSET + 1;
  const rawEnd = Math.max(payloadStart, data.length - 2);
  const raw = data.slice(payloadStart, rawEnd);
  // Reject a buffer too short to carry the chunk header.
  if (raw.length < 6) return null;

  const declaredSampleCount = readUint16LE(raw, 4);
  const availableSampleBytes = Math.max(0, raw.length - 6);
  const sampleBytes = Math.min(declaredSampleCount * 2, availableSampleBytes);
  const sampleCount = sampleBytes >> 1;
  const samples = new Uint16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = readUint16LE(raw, 6 + i * 2);
  }
  return {
    variant,
    chunkIndex: raw[2],
    declaredSampleCount,
    samples,
    sampleUnit: 'tenths-of-pounds',
    raw,
  };
}

// <Bug-17> Begin — bulk-read response classification + decode.
/**
 * Returns true when `data` looks like a bulk-read response. Matches
 * the frame-type byte (plain or extended) and the cmd byte at their
 * documented offsets. Bootstrap step 10's response is the canonical instance.
 */
function isBulkParamResponse(data: Uint8Array): boolean {
  if (data.length <= CMD_BYTE_OFFSET) return false;
  if (data[0] !== FRAME_MARKER) return false;
  const frameType = data[2];
  if (frameType !== RESPONSE_FRAME_TYPE && frameType !== RESPONSE_FRAME_TYPE_EXTENDED) {
    return false;
  }
  return data[CMD_BYTE_OFFSET] === CMD_PARAM_READ;
}

/** Where a read reply keeps its result byte and entry list. */
const READ_REPLY_LAYOUT: ParameterReportLayout = {
  resultOffset: BULK_PARAM_RESULT_OFFSET,
  countOffset: BULK_PARAM_COUNT_OFFSET,
  firstParamOffset: BULK_PARAM_FIRST_OFFSET,
};

/**
 * Build the reply a device sends to a multi-parameter read.
 *
 * The inverse of {@link decodeBulkParamResponse}, for device simulators and
 * tests. Throws for a register whose report width the protocol data does not
 * carry, since guessing one would mis-align every field after it.
 */
export function encodeBulkParamResponse(
  params: ReadonlyArray<{ paramIdHex: string; value: number }>
): Uint8Array {
  const widths = params.map(({ paramIdHex }) => {
    const width = resolveReportWidth(paramIdHex);
    if (width === null) {
      throw new Error(`encodeBulkParamResponse: unmodelled value width for '${paramIdHex}'`);
    }
    return width;
  });

  const size = BULK_PARAM_FIRST_OFFSET + widths.reduce((n, w) => n + 2 + w, 0) + 2;
  const frame = new Uint8Array(size);
  frame[2] = RESPONSE_FRAME_TYPE;
  frame[CMD_BYTE_OFFSET] = CMD_PARAM_READ;
  frame[BULK_PARAM_COUNT_OFFSET] = params.length & 0xff;
  frame[BULK_PARAM_COUNT_OFFSET + 1] = (params.length >> 8) & 0xff;

  let offset = BULK_PARAM_FIRST_OFFSET;
  params.forEach(({ paramIdHex, value }, i) => {
    frame.set(hexToBytes(paramIdHex), offset);
    offset += 2;
    for (let byte = 0; byte < widths[i]; byte++) {
      frame[offset + byte] = (value >> (byte * 8)) & 0xff;
    }
    offset += widths[i];
  });
  return sealEnvelope(frame);
}

/**
 * Decode a read reply into a {@link BulkParamResponse}.
 *
 * A reply whose result byte says the device refused the read decodes to no
 * params at all: its entry list is not there to read. Otherwise the shared
 * parameter-report walk applies, so a register the protocol data does not
 * carry a width for ends the walk and leaves `complete` false rather than
 * re-aligning every value after it.
 *
 * Returns `null` only if the buffer fails the frame-type / cmd-byte gate.
 */
export function decodeBulkParamResponse(data: Uint8Array): BulkParamResponse | null {
  if (!isBulkParamResponse(data)) return null;

  const report = decodeParameterReport(data, READ_REPLY_LAYOUT);
  return {
    paramCount: report.params.length,
    settings: paramsToSettings(report.params),
    complete: report.complete,
  };
}
// <Bug-17> End

/**
 * Decode a BLE notification.
 * Returns structured data based on message type.
 */
/**
 * True when the frame is the device's report of whether it accepted the
 * connection — not the transport-level ack, which only says the write landed.
 */
function isAcceptanceReport(data: Uint8Array): boolean {
  if (!ACCEPTANCE_REPORT) return false;
  if (data.length !== ACCEPTANCE_REPORT.frameLength) return false;
  if (data[ACCEPTANCE_REPORT.cmdByteOffset] !== ACCEPTANCE_REPORT.cmdValue) return false;
  return ACCEPTANCE_REPORT.identifierBytes.every(
    (b, i) => data[ACCEPTANCE_REPORT.identifierOffset + i] === b
  );
}

/**
 * Decode the connection-acceptance report.
 *
 * `accepted` is true only for the one status value the device sends when it
 * accepted; every other value is a refusal, since no refusal has been captured
 * to map individually. Returns `null` for any frame that is not this report.
 */
export function decodeAcceptanceReport(
  data: Uint8Array
): { accepted: boolean; status: number } | null {
  if (!ACCEPTANCE_REPORT || !isAcceptanceReport(data)) return null;
  const status = data[ACCEPTANCE_REPORT.statusOffset];
  return { accepted: status === ACCEPTANCE_REPORT.acceptedStatus, status };
}

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

    case 'vendor_set_summary': {
      const event = decodeVendorSetSummary(data);
      return event ? { type: 'setSummary', event } : { type: 'unknown', data };
    }

    case 'mode_confirmation':
      return decodeModeConfirmation(data);

    case 'settings_update':
    case 'multi_param':
      return decodeSettingsUpdate(data);

    // eslint-disable-next-line voltras/no-private-provenance -- exported `MessageType` member; renaming it is a breaking API change (VW-214, see CONTRIBUTING.md)
    case 'cmd_0f_bulk_response': {
      // <Bug-17> Reuse the `settings_update` dispatch path so existing
      // `onSettingsUpdate` listeners (and `syncSettingsFromDevice`) populate
      // `_settings` automatically — the bulk response carries the same
      // DeviceSettings shape as an async-state update.
      const decoded = decodeBulkParamResponse(data);
      return decoded ? { type: 'settings_update', settings: decoded.settings } : null;
    }

    case 'connection_acceptance': {
      const report = decodeAcceptanceReport(data);
      return report ? { type: 'connection_acceptance', ...report } : { type: 'unknown', data };
    }

    // Neither frame reports a battery level. The byte each was read for is
    // a marker in one and a length coincidence in the other, and battery
    // reaches listeners from the register that actually carries it.
    case 'device_init':
    case 'status_update':
      return { type: 'unknown', data };

    // <Decoder-statedump-asyncstate>
    // eslint-disable-next-line voltras/no-private-provenance -- exported `MessageType` member; renaming it is a breaking API change (VW-214, see CONTRIBUTING.md)
    case 'cmd10_async_state':
      return decodeAsyncStateToResult(data);

    case 'vendor_state_dump':
      return decodeStateDumpToResult(data);

    case 'vendor_rowing_runtime': {
      const event = decodeRowingRuntime(data);
      return event ? { type: 'rowing_runtime', event } : { type: 'unknown', data };
    }

    case 'vendor_isometric_summary': {
      const event = decodeIsometricSummary(data);
      return event ? { type: 'isometric_summary', event } : { type: 'unknown', data };
    }

    case 'vendor_waveform_chunk': {
      const event = decodeWaveformChunk(data);
      return event ? { type: 'waveform_chunk', event } : { type: 'unknown', data };
    }

    default:
      return { type: 'unknown', data };
  }
}

// =============================================================================
// Encoder (for replay)
// =============================================================================

/**
 * Encode a TelemetryFrame into a BLE notification payload.
 * Creates a message that can be decoded by decodeTelemetryFrame.
 * Used for replay functionality.
 *
 * The result is a whole sealed frame, sized as the device sizes one, so it
 * survives the notification path's envelope validation (VW-409).
 */
export function encodeTelemetryFrame(frame: TelemetryFrame): Uint8Array {
  const header = MessageTypes.TELEMETRY_STREAM;
  const data = new Uint8Array(header[1]);
  data.set(header);

  writeUint16LE(data, TelemetryOffsets.SEQUENCE, frame.sequence);

  data[TelemetryOffsets.PHASE] = frame.phase;

  // Position and force are unsigned; velocity is signed, flipping with
  // direction. Force is in tenths of pounds.
  writeUint16LE(data, TelemetryOffsets.POSITION, frame.position);
  writeUint16LE(data, TelemetryOffsets.FORCE, frame.force);
  writeInt16LE(data, TelemetryOffsets.VELOCITY, frame.velocity);

  return sealEnvelope(data);
}
