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
import type {
  BulkParamResponse,
  DeviceSettings,
  StateDumpEvent,
  RowingSummaryEvent,
  RowingStatusEvent,
  WaveformChunkEvent,
  AsyncStateFrame,
  AsyncStateParam,
} from './types';
import type { PerRepEvent, SummaryEvent, SetSummaryEvent, InProgressEvent } from '../../sdk/types';

// =============================================================================
// Param ID constants
// =============================================================================

/**
 * Param ID for damperLevel.
 *
 * The literal below is the WIRE-byte hex string — the paramID's two bytes in
 * little-endian order, not the paramID itself. The convention elsewhere in
 * this decoder treats `paramIdHex` the same way, so this matches the bytes
 * the device actually sends (verified on-device, and against the
 * protocol-data `damperLevel` TX command bytes, which encode the paramID
 * identically).
 *
 * damperLevel was identified on-device 2026-05-06 as one of the ~9 registers
 * in the settingsUpdate curated subset. Hardcoded here pending a future regen
 * sync that promotes it into `protocol.telemetry.paramIds`.
 */
const DAMPER_LEVEL_PARAM_ID_HEX = '0351';

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
/** Rowing-mode AA-frame sub-type identifiers (see types.ts comments). */
const ROWING_SUMMARY_SUBTYPE_0 = 0x95;
const ROWING_SUMMARY_SUBTYPE_1 = 0x25;
const ROWING_STATUS_SUBTYPE_0 = 0x92;
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
/** Frame offset of the param-count u16 LE in a bulk-read response. */
const BULK_PARAM_COUNT_OFFSET = 12;
/** Frame offset of the first param pair in a bulk-read response. */
const BULK_PARAM_FIRST_OFFSET = 14;

/**
 * Per-paramId value width (bytes) for params decoded from bulk-read
 * responses. Only the params surfaced through `DeviceSettings` are listed —
 * the decoder uses {@link Uint16ParamIds} for everything else, falling back
 * to abort decoding if neither table covers the paramId. Bootstrap step 10
 * (18-param query) covers all of these plus quick cable adjustment, whose
 * width is not yet known.
 *
 * Param IDs are stored as little-endian hex strings to match `ParamIdHex`.
 */
const KNOWN_PARAM_WIDTHS: Readonly<Record<string, number>> = {
  // Step-10 response carries these as uint16 LE (lb / index / state).
  '863e': 2, // base weight
  '873e': 2, // chains weight
  '883e': 2, // eccentric weight (signed; readParamValue handles sign)
  '893e': 2, // fitness mode (also covered by Uint16ParamIds)
  '823e': 2, // runtime cable position, cm
  '6a50': 2, // saved cable offset, cm
  '6253': 2, // resistance-band max force
  b753: 2, // resistance-band length
  '3154': 2, // isometric max force
  d253: 2, // isometric max duration
  // Step-10 response carries these as uint8 flags / enums.
  '6153': 1, // resistance-band algorithm
  b653: 1, // resistance-band length by ROM
  e352: 1, // resistance-band inverse
  '0651': 1, // assist mode
  b053: 1, // inverse chains
  c653: 1, // weight-training extra mode
  b04f: 1, // workout state (training mode)
  // damperLevel — key is the wire-byte hex (little-endian), not the paramID.
  // An earlier version of this table had the two bytes inverted.
  '0351': 1, // damper ratio index
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
  | 'vendor_rowing_summary'
  | 'vendor_rowing_status'
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
  if (
    data.length >= STATE_DUMP_FRAME_LENGTH &&
    data[CMD_BYTE_OFFSET] === VendorMessages.cmdValue &&
    data[CMD_BYTE_OFFSET + 1] === STATE_DUMP_SUBTYPE_0 &&
    data[CMD_BYTE_OFFSET + 2] === STATE_DUMP_SUBTYPE_1
  ) {
    return 'vendor_state_dump';
  }
  if (
    data[CMD_BYTE_OFFSET] === VendorMessages.cmdValue &&
    data[CMD_BYTE_OFFSET + 1] === ROWING_SUMMARY_SUBTYPE_0 &&
    data[CMD_BYTE_OFFSET + 2] === ROWING_SUMMARY_SUBTYPE_1
  ) {
    return 'vendor_rowing_summary';
  }
  if (
    data[CMD_BYTE_OFFSET] === VendorMessages.cmdValue &&
    data[CMD_BYTE_OFFSET + 1] === ROWING_STATUS_SUBTYPE_0
  ) {
    return 'vendor_rowing_status';
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
  | { type: 'rowing_summary'; event: RowingSummaryEvent }
  | { type: 'rowing_status'; event: RowingStatusEvent }
  | { type: 'waveform_chunk'; event: WaveformChunkEvent }
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

// setSummary peak-aggregate offsets are not carried by the regen's `fields`
// block, so they are hardcoded here in the same style as the inProgress
// offsets below. Both are corroborated on-device rather than
// vendor-confirmed — see `SetSummaryEvent` for the evidence and for the
// units caveat on peak power. A time-to-peak field is believed to live in this
// frame, but its candidate offset decodes to longer than the entire rep in a
// single-rep capture, so it is deliberately left undecoded.
const SET_SUMMARY_PEAK_FORCE_OFFSET = 28;
const SET_SUMMARY_PEAK_POWER_OFFSET = 32;

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

  return {
    schemaVersion: schemaVersionByte as VendorSchemaVersion,
    targetWeightTenths: readUint16LE(
      data,
      frameOffsetOf(cfg.fields.targetWeightTenths.payloadOffset)
    ),
    repCount: readUint16LE(data, frameOffsetOf(cfg.fields.repCount.payloadOffset)),
    repDurationMs: readUint32LE(data, frameOffsetOf(cfg.fields.repDurationMs.payloadOffset)),
    peakForceTenths: readUint16LE(data, SET_SUMMARY_PEAK_FORCE_OFFSET),
    peakPowerRaw: readUint16LE(data, SET_SUMMARY_PEAK_POWER_OFFSET),
    raw: data.slice(),
  };
}

// inProgress field offsets are validated on-device (2026-05-06) but not yet
// carried by the generated telemetry config; hardcoded here pending a future
// regen sync.
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

  const params = decodeAsyncStateParams(data, config.paramCountOffset, config.firstParamOffset);
  return { type: 'settings_update', settings: paramsToSettings(params) };
}

// <Decoder-statedump-asyncstate> ==========================================================
// Generic async-state decoder.
//
// Every async-state frame shares one payload shape, so a single walker serves
// both this path and the legacy `settingsUpdate` path. A value is uint8 by
// default, or uint16 LE for the param IDs listed in `Uint16ParamIds`. The
// offsets are the module constants above.
//
// `decodeAsyncState` returns the structured param list; `decodeAsyncStateToResult`
// tries to project it into a `mode_confirmation` (single TRAINING_MODE
// param) or `settings_update` (any other recognized params). Frames whose
// only param is unrecognized still return `settings_update` with an empty
// settings bag — this is intentional: the bridge can ignore the empty bag
// rather than mis-routing the frame to `unknown`.
// ==========================================================
/**
 * Decode the param list of a async-state frame. Stops parsing at
 * the first truncated/malformed param so callers can rely on returned
 * params being well-formed.
 */
export function decodeAsyncState(data: Uint8Array): AsyncStateFrame | null {
  if (data.length < ASYNC_STATE_FIRST_PARAM_OFFSET + 3) return null;
  if (data[CMD_BYTE_OFFSET] !== CMD_ASYNC_STATE) return null;
  const paramCount = data[ASYNC_STATE_PARAM_COUNT_OFFSET];
  // Cap at 16 to avoid any pathological frame steering us into a long loop.
  // Real captures top out at 9 params.
  if (paramCount === 0 || paramCount > 16) {
    return { paramCount, params: [] };
  }
  const params = decodeAsyncStateParams(
    data,
    ASYNC_STATE_PARAM_COUNT_OFFSET,
    ASYNC_STATE_FIRST_PARAM_OFFSET
  );
  return { paramCount, params };
}

/**
 * Walk the `<paramID-LE><value>` triplets of a async-state-shaped frame. Used
 * by both the async-state path and the legacy `settingsUpdate` header path;
 * both share the same count / reserved / param-list encoding starting at
 * `firstParamOffset`.
 */
function decodeAsyncStateParams(
  data: Uint8Array,
  paramCountOffset: number,
  firstParamOffset: number
): AsyncStateParam[] {
  const params: AsyncStateParam[] = [];
  if (paramCountOffset >= data.length) return params;
  const paramCount = data[paramCountOffset];
  let offset = firstParamOffset;
  for (let i = 0; i < paramCount && i < 16; i++) {
    if (offset + 2 > data.length) break;
    const paramIdHex = bytesToHex(data.slice(offset, offset + 2));
    offset += 2;

    const isUint16 = Uint16ParamIds.has(paramIdHex);
    const byteLength: 1 | 2 = isUint16 ? 2 : 1;
    if (offset + byteLength > data.length) break;
    const value = isUint16 ? readUint16LE(data, offset) : data[offset];
    offset += byteLength;
    params.push({ paramIdHex, value, byteLength });
  }
  return params;
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
      // damperLevel decodes as a uint8 and is one of the ~9 registers
      // reflected in the settingsUpdate curated subset.
      settings.damperLevel = value;
    }
  }
  return settings;
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
// Rowing-mode telemetry decoders (HYPOTHESIS — see types.ts)
// =============================================================================

/**
 * Decode a rowing summary frame.
 *
 * Pace is reported in **milliseconds per 500 m** and distance in **meters**.
 * Stroke count is reported as whole strokes (rounded toward zero).
 *
 * Returns `null` if the buffer doesn't match the sub-type bytes or is too
 * short to safely read all documented fields. Callers needing partial data
 * should fall back to walking `event.raw`.
 */
export function decodeRowingSummary(data: Uint8Array): RowingSummaryEvent | null {
  if (data[CMD_BYTE_OFFSET] !== VendorMessages.cmdValue) return null;
  if (data[CMD_BYTE_OFFSET + 1] !== ROWING_SUMMARY_SUBTYPE_0) return null;
  if (data[CMD_BYTE_OFFSET + 2] !== ROWING_SUMMARY_SUBTYPE_1) return null;

  const payloadStart = CMD_BYTE_OFFSET + 1;
  // Exclude the CRC trailer from raw if the frame is long enough.
  const rawEnd = Math.max(payloadStart, data.length - 2);
  const raw = data.slice(payloadStart, rawEnd);

  // The distance field sits near the end of the body, so verify the length
  // before reading it.
  if (raw.length < 39) return null;

  return {
    strokeRateSpm: raw[2],
    currentPaceMs: readUint32LE(raw, 3) * 100,
    averagePaceMs: readUint32LE(raw, 7) * 100,
    strokeCount: Math.trunc(readUint32LE(raw, 19) / 100),
    distanceMeters: readUint32LE(raw, 35),
    raw,
  };
}

/**
 * Decode a rowing status frame. Distance unit on the
 * decoder converts to meters.
 *
 * Returns `null` if the body is shorter than the documented field span.
 */
export function decodeRowingStatus(data: Uint8Array): RowingStatusEvent | null {
  if (data[CMD_BYTE_OFFSET] !== VendorMessages.cmdValue) return null;
  if (data[CMD_BYTE_OFFSET + 1] !== ROWING_STATUS_SUBTYPE_0) return null;

  const payloadStart = CMD_BYTE_OFFSET + 1;
  const rawEnd = Math.max(payloadStart, data.length - 2);
  const raw = data.slice(payloadStart, rawEnd);
  if (raw.length < 15) return null;

  return {
    strokeRateSpm: raw[2],
    distanceMeters: readUint32LE(raw, 11) / 100,
    raw,
  };
}

/**
 * Decode a waveform chunk frame. The variant byte distinguishes isometric
 * from rowing. Caller is responsible for assembling chunks across frames
 * using `chunkIndex`.
 *
 * **Sample units:** `tenths-of-pounds`. Rowing samples are tenths-of-lb
 * directly; isometric callers must scale tenths-of-pounds by 4.4482216 to
 * get newtons.
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
  if (data[0] !== 0x55) return false;
  const frameType = data[2];
  if (frameType !== RESPONSE_FRAME_TYPE && frameType !== RESPONSE_FRAME_TYPE_EXTENDED) {
    return false;
  }
  return data[CMD_BYTE_OFFSET] === CMD_PARAM_READ;
}

/**
 * Resolve the wire width (in bytes) of a paramId's value field in a bulk-read
 * response, or `null` if the SDK does not model this paramId yet. Falls back
 * to {@link Uint16ParamIds} for params present in `protocol.json`.
 */
function resolveParamValueWidth(paramIdHex: string): number | null {
  const known = KNOWN_PARAM_WIDTHS[paramIdHex];
  if (known !== undefined) return known;
  if (Uint16ParamIds.has(paramIdHex)) return 2;
  return null;
}

/** Read a value of the given width and apply paramId-specific signedness. */
function readParamValue(
  data: Uint8Array,
  offset: number,
  width: number,
  paramIdHex: string
): number {
  if (width === 1) return data[offset];
  if (width === 2) {
    // Eccentric weight is signed lb on the wire.
    if (paramIdHex === ParamIdHex.ECCENTRIC) return readInt16LE(data, offset);
    return readUint16LE(data, offset);
  }
  // Width 4 / other widths are not currently resolved by
  // resolveParamValueWidth, so this branch is unreachable today. Kept as
  // a defensive default to avoid misreporting partial values.
  return readUint32LE(data, offset);
}

/**
 * Mutate `settings` to reflect the given paramId+value, mirroring
 * {@link decodeSettingsUpdate}'s curated subset (baseWeight / chains /
 * eccentric / trainingMode / inverseChains / damperLevel). Unmapped params
 * are intentionally ignored.
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
  } else if (paramIdHex === DAMPER_LEVEL_PARAM_ID_HEX) {
    settings.damperLevel = value;
  }
}

/**
 * Decode a bulk-read response into a {@link BulkParamResponse}.
 *
 * Walks the `[count, ...(paramId + value)]` payload using
 * {@link KNOWN_PARAM_WIDTHS} to size each value. Stops gracefully
 * (returning whatever has been decoded so far) on the first param whose
 * width is not in the known-widths table — this keeps mis-aligned reads
 * from corrupting downstream offsets when the device echoes a register the
 * SDK does not yet model.
 *
 * Returns `null` only if the buffer fails the frame-type / cmd-byte gate.
 */
export function decodeBulkParamResponse(data: Uint8Array): BulkParamResponse | null {
  if (!isBulkParamResponse(data)) return null;
  if (data.length < BULK_PARAM_FIRST_OFFSET) return null;

  const declaredCount = readUint16LE(data, BULK_PARAM_COUNT_OFFSET);
  const settings: DeviceSettings = {};
  let offset = BULK_PARAM_FIRST_OFFSET;
  let decoded = 0;

  for (let i = 0; i < declaredCount; i++) {
    if (offset + 2 > data.length) break;
    const paramIdHex = bytesToHex(data.slice(offset, offset + 2));
    offset += 2;

    const width = resolveParamValueWidth(paramIdHex);
    if (width === null) break;
    if (offset + width > data.length) break;

    const value = readParamValue(data, offset, width, paramIdHex);
    offset += width;
    decoded++;

    applyParamToSettings(settings, paramIdHex, value);
  }

  return { paramCount: decoded, settings };
}
// <Bug-17> End

/**
 * Decode a device status notification.
 *
 * Hotfix in 0.5.2: the byte the `deviceInit` frame was being read for
 * battery is a sub-command marker, not a battery percentage. Reading it as
 * battery produced impossible values, well over 100%. Battery now arrives
 * through the async-state settings cascade under its own paramID, so the
 * `deviceInit` branch no longer emits a `device_status` event and the frame
 * falls through to `unknown` until a proper decoder lands.
 *
 * The `statusBattery` branch is kept intact for any non-state-dump traffic
 * on that header, but in practice the vendor-state-dump dispatch (which
 * precedes header detection) consumes it today.
 */
function decodeDeviceStatus(data: Uint8Array): DecodeResult {
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

    case 'device_init':
    case 'status_update':
      return decodeDeviceStatus(data);

    // <Decoder-statedump-asyncstate>
    // eslint-disable-next-line voltras/no-private-provenance -- exported `MessageType` member; renaming it is a breaking API change (VW-214, see CONTRIBUTING.md)
    case 'cmd10_async_state':
      return decodeAsyncStateToResult(data);

    case 'vendor_state_dump':
      return decodeStateDumpToResult(data);

    case 'vendor_rowing_summary': {
      const event = decodeRowingSummary(data);
      return event ? { type: 'rowing_summary', event } : { type: 'unknown', data };
    }

    case 'vendor_rowing_status': {
      const event = decodeRowingStatus(data);
      return event ? { type: 'rowing_status', event } : { type: 'unknown', data };
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
 * Creates a minimal message that can be decoded by decodeTelemetryFrame.
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

  writeUint16LE(data, TelemetryOffsets.SEQUENCE, frame.sequence);

  data[TelemetryOffsets.PHASE] = frame.phase;

  // Position and force are unsigned; velocity is signed, flipping with
  // direction. Force is in tenths of pounds.
  writeUint16LE(data, TelemetryOffsets.POSITION, frame.position);
  writeUint16LE(data, TelemetryOffsets.FORCE, frame.force);
  writeInt16LE(data, TelemetryOffsets.VELOCITY, frame.velocity);

  return data;
}
