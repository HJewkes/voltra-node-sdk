/**
 * Guided-load (direct-load) protocol helpers (Phase 1g, 0.6.3+).
 *
 * Builds the BLE frames required to trigger and observe the firmware's
 * direct-load (`0x12`) flow, plus a decoder for the 4 status registers
 * polled during the post-trigger 18-second window.
 *
 * Source-of-truth: voltra-private/research/direct-load-protocol-
 * 2026-05-06-android-deep.md (§1-§5). The protocol-derived constants below
 * (the `0x12` payload byte, the 4 status paramIDs, and the fitness-mode
 * values 0x0026/0x0027/0x0004) live here rather than in the generated
 * protocol-data.json so the SDK does not depend on a regen for this flow.
 *
 * The exact byte sequence emitted by `buildGuidedLoadTriggerFrame()` matches
 * the Campaign 8 on-wire capture (`550e0466aa1000202000aa125231`) — see the
 * doc above §1.
 */

import { calculateCRC8, calculateCRC16 } from './_factories/checksum.generated';
import { NotificationConfigs } from './constants';
import { bytesToHex } from '../../shared/utils';

// =============================================================================
// Protocol-derived constants (KEEP MINIMAL — full rationale lives in
// voltra-private/research/direct-load-protocol-2026-05-06-android-deep.md)
// =============================================================================

/** Inner payload byte that triggers the direct-load flow under cmd 0xAA. */
const DIRECT_LOAD_TRIGGER_PAYLOAD = 0x12;

/** Inner cmd byte for vendor (0xAA) and param read (0x0F). */
const CMD_VENDOR = 0xaa;
const CMD_PARAM_READ = 0x0f;

/**
 * BP_SET_FITNESS_MODE register values relevant to direct-load (uint16 LE,
 * register `0x3E89`). Other modes (idle/strength/etc.) are unaffected here.
 */
const FITNESS_MODE_DIRECT_LOAD_READY = 0x0026;
const FITNESS_MODE_DIRECT_LOAD_ACTIVE = 0x0027;
/** STRENGTH_READY — used to exit guided-load cleanly (`exitGuidedLoad`). */
const FITNESS_MODE_STRENGTH_READY = 0x0004;

// Direct-load engagement safety-check register (0x538D — `EP_DIRECT_LOAD_SAFETY_CHECK`,
// uint8 arm bit). Per voltra-private parameters/ep/direct-load-safety-check.ts.
export const PARAM_DIRECT_LOAD_SAFETY_CHECK = 0x538d;
// Direct-load `ST` status register (0x53C7 — `EP_DIRECT_LOAD_ST`, uint8 phase enum).
// Per voltra-private parameters/ep/direct-load-st.ts.
export const PARAM_DIRECT_LOAD_ST = 0x53c7;
// Direct-load countdown register (0x53C8 — `EP_DIRECT_LOAD_COUNTDOWN`, uint16 LE
// countdown ms, max 3000). Per voltra-private parameters/ep/direct-load-countdown.ts.
export const PARAM_DIRECT_LOAD_COUNTDOWN = 0x53c8;
// Direct-load `CTRL` runtime control register (0x53C9 — `EP_DIRECT_LOAD_CTRL`, uint8).
// Per voltra-private parameters/ep/direct-load-ctrl.ts.
export const PARAM_DIRECT_LOAD_CTRL = 0x53c9;

const STATUS_PARAM_IDS_LE = [
  PARAM_DIRECT_LOAD_SAFETY_CHECK,
  PARAM_DIRECT_LOAD_ST,
  PARAM_DIRECT_LOAD_COUNTDOWN,
  PARAM_DIRECT_LOAD_CTRL,
] as const;

// Mode register 0x3E89 — write target = `[0x04, 0x00]` (LE) to exit cleanly.
const PARAM_BP_SET_FITNESS_MODE = 0x3e89;

// =============================================================================
// Frame envelope (mirrors AndroidVoltraClient's VoltraFrameBuilder.kt:18-84)
// =============================================================================

const START_MARKER = 0x55;
const CATEGORY = 0x04;
const APP_TO_DEVICE: readonly [number, number] = [0xaa, 0x10];
const HEADER_SUFFIX: readonly [number, number] = [0x20, 0x00];
const DEFAULT_SEQUENCE = 0x2000;

/**
 * Build a vendor envelope frame with `cmd 0xAA` and a single-byte payload.
 *
 * For the direct-load trigger this produces 14 bytes total:
 *   `55 0E 04 <crc8> AA 10 <seq_lo> <seq_hi> 20 00 AA 12 <crc16_lo> <crc16_hi>`
 *
 * Sequence defaults to `0x2000` to match the captured trigger; callers that
 * need a fresh sequence can override it.
 */
export function buildGuidedLoadTriggerFrame(sequence: number = DEFAULT_SEQUENCE): Uint8Array {
  const totalSize = 14;
  const frame = new Uint8Array(totalSize);
  frame[0] = START_MARKER;
  frame[1] = totalSize;
  frame[2] = CATEGORY;
  frame[3] = calculateCRC8(frame.subarray(0, 3));
  frame[4] = APP_TO_DEVICE[0];
  frame[5] = APP_TO_DEVICE[1];
  frame[6] = sequence & 0xff;
  frame[7] = (sequence >> 8) & 0xff;
  frame[8] = HEADER_SUFFIX[0];
  frame[9] = HEADER_SUFFIX[1];
  frame[10] = CMD_VENDOR;
  frame[11] = DIRECT_LOAD_TRIGGER_PAYLOAD;
  const crc = calculateCRC16(frame.subarray(0, totalSize - 2));
  frame[totalSize - 2] = crc & 0xff;
  frame[totalSize - 1] = (crc >> 8) & 0xff;
  return frame;
}

/**
 * Build the multi-paramID read frame for the 4 direct-load status registers.
 *
 * Wire payload after the cmd byte:
 *   `count_lo count_hi <id0_lo id0_hi> ... <id3_lo id3_hi>` (count = 4)
 *
 * The cmd byte is `0x0F` (CMD_PARAM_READ).
 */
export function buildGuidedLoadStatusReadFrame(sequence: number = DEFAULT_SEQUENCE): Uint8Array {
  // Payload: count uint16 LE + 4 paramIDs uint16 LE = 2 + 4*2 = 10 bytes.
  const payload = new Uint8Array(2 + STATUS_PARAM_IDS_LE.length * 2);
  payload[0] = STATUS_PARAM_IDS_LE.length & 0xff;
  payload[1] = (STATUS_PARAM_IDS_LE.length >> 8) & 0xff;
  for (let i = 0; i < STATUS_PARAM_IDS_LE.length; i++) {
    payload[2 + i * 2] = STATUS_PARAM_IDS_LE[i] & 0xff;
    payload[2 + i * 2 + 1] = (STATUS_PARAM_IDS_LE[i] >> 8) & 0xff;
  }

  const totalSize = 13 + payload.length; // envelope + payload + 2-byte CRC16 (envelope already adds 2)
  const frame = new Uint8Array(totalSize);
  frame[0] = START_MARKER;
  frame[1] = totalSize;
  frame[2] = CATEGORY;
  frame[3] = calculateCRC8(frame.subarray(0, 3));
  frame[4] = APP_TO_DEVICE[0];
  frame[5] = APP_TO_DEVICE[1];
  frame[6] = sequence & 0xff;
  frame[7] = (sequence >> 8) & 0xff;
  frame[8] = HEADER_SUFFIX[0];
  frame[9] = HEADER_SUFFIX[1];
  frame[10] = CMD_PARAM_READ;
  frame.set(payload, 11);
  const crc = calculateCRC16(frame.subarray(0, totalSize - 2));
  frame[totalSize - 2] = crc & 0xff;
  frame[totalSize - 1] = (crc >> 8) & 0xff;
  return frame;
}

/**
 * Build the parametric write frame that exits guided-load cleanly:
 *   `BP_SET_FITNESS_MODE (0x3E89) := 0x0004` (STRENGTH_READY).
 */
export function buildGuidedLoadExitFrame(sequence: number = DEFAULT_SEQUENCE): Uint8Array {
  // Standard parametric set frame: header(10) + cmdId(0x11) + reserved(2) +
  // paramId(2 BE) + value(2 LE) + crc16(2) = 19 bytes.
  // NOTE: the existing buildCommandBytes uses the same envelope but with a
  // different cmdId byte ordering for the param. We mirror that layout here
  // (param written big-endian into the frame as in `command-builder.generated`).
  const totalSize = 19;
  const frame = new Uint8Array(totalSize);
  frame[0] = START_MARKER;
  frame[1] = totalSize;
  frame[2] = CATEGORY;
  frame[3] = calculateCRC8(frame.subarray(0, 3));
  frame[4] = APP_TO_DEVICE[0];
  frame[5] = APP_TO_DEVICE[1];
  frame[6] = sequence & 0xff;
  frame[7] = (sequence >> 8) & 0xff;
  frame[8] = HEADER_SUFFIX[0];
  frame[9] = HEADER_SUFFIX[1];
  frame[10] = 0x11; // CMD_PARAM_WRITE
  frame[11] = 0x01; // RESERVED[0]
  frame[12] = 0x00; // RESERVED[1]
  frame[13] = (PARAM_BP_SET_FITNESS_MODE >> 8) & 0xff; // BE high byte
  frame[14] = PARAM_BP_SET_FITNESS_MODE & 0xff; // BE low byte
  frame[15] = FITNESS_MODE_STRENGTH_READY & 0xff; // value LE low
  frame[16] = (FITNESS_MODE_STRENGTH_READY >> 8) & 0xff; // value LE high
  const crc = calculateCRC16(frame.subarray(0, totalSize - 2));
  frame[totalSize - 2] = crc & 0xff;
  frame[totalSize - 1] = (crc >> 8) & 0xff;
  return frame;
}

// =============================================================================
// Status decoder
// =============================================================================

/**
 * Subset of the guided-load registers carried by a single multi-param read
 * response. All fields are optional — the device may pack any subset of the
 * 4 registers into a given response notification.
 */
export interface GuidedLoadStatusFields {
  /** EP_DIRECT_LOAD_SAFETY_CHECK (`0x538D`, uint8) — bool-like state-machine arm bit. */
  primaryStatus?: number;
  /** EP_DIRECT_LOAD_ST (`0x53C7`, uint8) — phase enum. */
  forceStatus?: number;
  /** EP_DIRECT_LOAD_COUNTDOWN (`0x53C8`, uint16 LE) — safety countdown remaining (ms). */
  countdownMs?: number;
  /** EP_DIRECT_LOAD_CTRL (`0x53C9`, uint8) — runtime control byte. */
  runtimeStatus?: number;
  /** Raw `BP_SET_FITNESS_MODE` (`0x3E89`, uint16 LE) — only present when
   *  the device echoes it in a settings/multi-param response. */
  fitnessModeRaw?: number;
}

/** ParamId ↔ field map (matched against the LE-byte hex emitted by the
 *  multi-param decoder helpers below). */
const FIELD_PARAM_IDS_LE_HEX = {
  // 0x538D LE = 0x8D 0x53 → "8d53"
  primaryStatus: '8d53',
  // 0x53C7 LE = "c753"
  forceStatus: 'c753',
  // 0x53C8 LE = "c853"
  countdownMs: 'c853',
  // 0x53C9 LE = "c953"
  runtimeStatus: 'c953',
  // 0x3E89 LE = "893e"
  fitnessModeRaw: '893e',
} as const;

const UINT16_PARAM_IDS_LE_HEX: ReadonlySet<string> = new Set([
  FIELD_PARAM_IDS_LE_HEX.countdownMs,
  FIELD_PARAM_IDS_LE_HEX.fitnessModeRaw,
]);

/**
 * Decode a multi-param response (header `0x16`) or settings-update
 * notification (header `0x2e`) into the subset of guided-load fields it
 * carries. Returns `null` if the buffer is not a multi-param payload or
 * carries none of the 4 status registers.
 *
 * Mirrors the structure of `decodeSettingsUpdate` in `telemetry-decoder.ts`
 * but with guided-load-specific paramIds and uint16/uint8 sizing rules.
 */
export function decodeGuidedLoadStatus(data: Uint8Array): GuidedLoadStatusFields | null {
  // Accept either the multi-param shape (header 0x16) or settings-update
  // (header 0x2e) — both share the count + paramId/value layout.
  const header2 = bytesToHex(data.slice(0, 2));
  const multi = NotificationConfigs.multiParam;
  const settings = NotificationConfigs.settingsUpdate;
  let cfg: typeof multi;
  if (header2 === multi.header) {
    cfg = multi;
  } else if (header2 === settings.header) {
    cfg = settings;
  } else {
    return null;
  }
  if (cfg.paramCountOffset === undefined || cfg.firstParamOffset === undefined) {
    return null;
  }

  const paramCount = data[cfg.paramCountOffset];
  let offset = cfg.firstParamOffset;
  const out: GuidedLoadStatusFields = {};
  let matched = false;

  for (let i = 0; i < paramCount && i < 9; i++) {
    if (offset + 2 > data.length) break;
    const paramIdHex = bytesToHex(data.slice(offset, offset + 2));
    offset += 2;

    const isUint16 = UINT16_PARAM_IDS_LE_HEX.has(paramIdHex);
    let value: number;
    if (isUint16) {
      if (offset + 2 > data.length) break;
      value = data[offset] | (data[offset + 1] << 8);
      offset += 2;
    } else {
      if (offset + 1 > data.length) break;
      value = data[offset];
      offset += 1;
    }

    if (paramIdHex === FIELD_PARAM_IDS_LE_HEX.primaryStatus) {
      out.primaryStatus = value;
      matched = true;
    } else if (paramIdHex === FIELD_PARAM_IDS_LE_HEX.forceStatus) {
      out.forceStatus = value;
      matched = true;
    } else if (paramIdHex === FIELD_PARAM_IDS_LE_HEX.countdownMs) {
      out.countdownMs = value;
      matched = true;
    } else if (paramIdHex === FIELD_PARAM_IDS_LE_HEX.runtimeStatus) {
      out.runtimeStatus = value;
      matched = true;
    } else if (paramIdHex === FIELD_PARAM_IDS_LE_HEX.fitnessModeRaw) {
      out.fitnessModeRaw = value;
      matched = true;
    }
  }

  return matched ? out : null;
}

/** Mode-register raw value indicating "armed, awaiting pull". */
export const GUIDED_LOAD_MODE_ARMED = FITNESS_MODE_DIRECT_LOAD_READY;
/** Mode-register raw value indicating "active, ramping/at-target". */
export const GUIDED_LOAD_MODE_ACTIVE = FITNESS_MODE_DIRECT_LOAD_ACTIVE;
/** Mode-register raw value used to exit guided-load cleanly. */
export const GUIDED_LOAD_MODE_EXIT = FITNESS_MODE_STRENGTH_READY;
