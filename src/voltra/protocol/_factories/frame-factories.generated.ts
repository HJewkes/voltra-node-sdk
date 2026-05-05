// @generated — do not edit. Regenerate: npm run build (from voltra-private)
/**
 * Frame Factories
 *
 * Test utilities that produce well-formed protocol frames (correct CRC,
 * correct envelope, correct sub-type bytes) for any documented frame type.
 *
 * Used by:
 *   - voltra-private's own tests (verifying factory output against metadata)
 *   - voltra-node-sdk's decoder tests (synthesizing inbound frames the SDK
 *     should be able to parse — copied via build.ts as a `.generated.ts`
 *     companion to `protocol-data.generated.ts`)
 *
 * Design intent:
 *   - Each factory's signature reflects the **documented** field shape, so
 *     tests can express intent: `buildVendorPerRepFrame({ motionPhase: 'pull',
 *     frameCounter: 0, setCounter: 1, repCount: 5 })` instead of magic hex strings.
 *   - Factories that ship without validated field offsets (rowing, isometric)
 *     take a raw payload and only handle the envelope + sub-type bytes.
 *   - All factories accept `FrameOpts` for sequence number, total length
 *     padding, and sender/receiver override.
 *
 * Wire-format drift protection: factory tests in `frame-factories.test.ts`
 * round-trip every output through the same metadata that decoders use.
 * If the protocol envelope changes, factory tests fail; if frame factories
 * silently drift, the SDK's decoder tests fail.
 */

import { calculateCRC8, calculateCRC16 } from './checksum.generated';
import { TELEMETRY_CONFIG } from './telemetry-config-source.generated';
// Inlined from voltra-private/src/protocol/enums.ts (type-only, no runtime impact).
type ValueType = 'uint8' | 'uint16' | 'int16' | 'uint32' | 'int32';
interface ParamDefinition {
  readonly id: number;
  readonly name: string;
  readonly valueType: ValueType;
}

import { buildCommandBytes } from './command-builder.generated';

// =============================================================================
// Constants
// =============================================================================

const START_MARKER = 0x55;
const CATEGORY = 0x04;
const HEADER_SUFFIX = [0x20, 0x00] as const;
const APP_TO_DEVICE: readonly [number, number] = [0xaa, 0x10];
const DEVICE_TO_APP: readonly [number, number] = [0x10, 0xaa];

const RESPONSE_FRAMES = TELEMETRY_CONFIG.responseFrames;
const VENDOR_MESSAGES = TELEMETRY_CONFIG.vendorMessages;

// =============================================================================
// Common options
// =============================================================================

export interface FrameOpts {
  /** Frame-offset 6–7 sequence value. Defaults to `0x2000`. */
  sequence?: number;
  /**
   * Pad payload to hit this exact frame length. Useful when the documented
   * frame length exceeds the meaningful payload (e.g. per-rep boundary is
   * 74 bytes but only the first ~7 bytes carry information). Defaults to
   * the minimum size for the supplied payload.
   */
  totalLength?: number;
  /**
   * Override sender/receiver bytes at frame offsets 4–5. Defaults to the
   * direction expected for the frame type — `[0xAA, 0x10]` for outbound
   * (app→device) commands, `[0x10, 0xAA]` for inbound (device→app)
   * notifications and responses.
   */
  senderReceiver?: readonly [number, number];
}

// =============================================================================
// Generic envelope
// =============================================================================

/**
 * Build a frame with arbitrary cmd byte and payload, computing both CRCs.
 *
 * Layout (frame offsets):
 *   0..3   universal header (start marker, length, category, header CRC8)
 *   4..5   sender/receiver
 *   6..7   sequence (LE uint16)
 *   8..9   header suffix (constant)
 *   10     cmd byte
 *   11..N-3 payload (caller-supplied, padded with zeros if `totalLength` is set)
 *   N-2..N-1 CRC16 (LE)
 *
 * Default sender/receiver is `APP_TO_DEVICE`. Override via `opts.senderReceiver`.
 */
export function buildEnvelopedFrame(
  cmdId: number,
  payload: Uint8Array,
  opts: FrameOpts = {}
): Uint8Array {
  const sequence = opts.sequence ?? 0x2000;
  const senderReceiver = opts.senderReceiver ?? APP_TO_DEVICE;

  const minSize = 13 + payload.length;
  const totalSize = opts.totalLength ?? minSize;
  if (totalSize < minSize) {
    throw new Error(
      `frame-factories: totalLength=${totalSize} is smaller than required ${minSize} (envelope + payload)`
    );
  }
  if (totalSize > 0xff) {
    throw new Error(
      `frame-factories: totalLength=${totalSize} exceeds the 1-byte length field (max 255)`
    );
  }

  const frame = new Uint8Array(totalSize);
  frame[0] = START_MARKER;
  frame[1] = totalSize;
  frame[2] = CATEGORY;
  frame[3] = calculateCRC8(frame.subarray(0, 3));
  frame[4] = senderReceiver[0];
  frame[5] = senderReceiver[1];
  frame[6] = sequence & 0xff;
  frame[7] = (sequence >> 8) & 0xff;
  frame[8] = HEADER_SUFFIX[0];
  frame[9] = HEADER_SUFFIX[1];
  frame[10] = cmdId;
  frame.set(payload, 11);
  // Bytes between payload-end and CRC stay zero (Uint8Array default).

  const crc = calculateCRC16(frame.subarray(0, totalSize - 2));
  frame[totalSize - 2] = crc & 0xff;
  frame[totalSize - 1] = (crc >> 8) & 0xff;
  return frame;
}

// =============================================================================
// Parametric (outbound)
// =============================================================================

/**
 * Build a parametric set-parameter frame. Thin wrapper around the existing
 * `buildCommandBytes` so factory consumers don't have to import from two
 * places. Sender/receiver defaults to `APP_TO_DEVICE`.
 */
export function buildParametricFrame(
  param: ParamDefinition,
  value: number,
  opts: FrameOpts = {}
): Uint8Array {
  // The existing builder already enforces the parametric envelope and CRCs.
  // We re-stamp sender/receiver and sequence afterwards if the caller wants
  // to override (cheap because the trailing CRC needs recomputing).
  const sequence = opts.sequence ?? 0x2000;
  const bytes = buildCommandBytes(param, value, sequence);
  if (opts.senderReceiver) {
    bytes[4] = opts.senderReceiver[0];
    bytes[5] = opts.senderReceiver[1];
    const crc = calculateCRC16(bytes.subarray(0, bytes.length - 2));
    bytes[bytes.length - 2] = crc & 0xff;
    bytes[bytes.length - 1] = (crc >> 8) & 0xff;
  }
  return bytes;
}

// =============================================================================
// Identity response frames (inbound, PR 5)
// =============================================================================

export type IdentityOpcodeKey =
  | 'deviceName'
  | 'serialNumber'
  | 'firmwareVersions'
  | 'activationState'
  | 'broadcastState';

/**
 * Build a device-to-app identity response frame.
 *
 * String payloads are encoded as ASCII and null-terminated (matches the
 * presumed `0x4F` device-name and `0x77` firmware-versions encoding). Pass a
 * `Uint8Array` directly to control the bytes exactly (e.g. for the binary
 * `0x19` serial-number response).
 */
export function buildIdentityResponseFrame(
  opcode: IdentityOpcodeKey,
  payload: Uint8Array | string,
  opts: FrameOpts = {}
): Uint8Array {
  const cfg = RESPONSE_FRAMES.knownResponses[opcode];
  const payloadBytes = typeof payload === 'string' ? encodeAsciiNullTerminated(payload) : payload;
  return buildEnvelopedFrame(cfg.cmdValue, payloadBytes, {
    senderReceiver: DEVICE_TO_APP,
    ...opts,
  });
}

function encodeAsciiNullTerminated(s: string): Uint8Array {
  const out = new Uint8Array(s.length + 1);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) {
      throw new Error(
        `frame-factories: non-ASCII char ${JSON.stringify(s[i])} in identity payload`
      );
    }
    out[i] = c;
  }
  out[s.length] = 0;
  return out;
}

// =============================================================================
// Vendor messages — typed (per-rep boundary + summary, PR 2)
// =============================================================================

export type PerRepMotionPhase = 'pull' | 'return';

/**
 * Build a vendor per-rep boundary frame (`0xAA 0x82 0x3B`, 74 bytes).
 *
 * Field positions follow `TELEMETRY_CONFIG.vendorMessages.subTypes.perRep.fields`.
 * Sender/receiver defaults to `DEVICE_TO_APP`.
 */
export function buildVendorPerRepFrame(
  fields: {
    motionPhase: PerRepMotionPhase | number;
    frameCounter: number;
    setCounter: number;
    repCount: number;
  },
  opts: FrameOpts = {}
): Uint8Array {
  const cfg = VENDOR_MESSAGES.subTypes.perRep;
  const payloadSize = cfg.frameLength - 13; // envelope = 11 header + 2 CRC
  const payload = new Uint8Array(payloadSize);

  // Sub-type identifier bytes at payload offset 0–1.
  payload[0] = cfg.identifierBytes[0];
  payload[1] = cfg.identifierBytes[1];

  const phaseValue =
    typeof fields.motionPhase === 'number'
      ? fields.motionPhase
      : cfg.motionPhases[fields.motionPhase];

  payload[cfg.fields.motionPhase.payloadOffset] = phaseValue & 0xff;
  payload[cfg.fields.frameCounter.payloadOffset] = fields.frameCounter & 0xff;
  payload[cfg.fields.setCounter.payloadOffset] = fields.setCounter & 0xff;
  payload[cfg.fields.repCount.payloadOffset] = fields.repCount & 0xff;

  return buildEnvelopedFrame(VENDOR_MESSAGES.cmdValue, payload, {
    senderReceiver: DEVICE_TO_APP,
    totalLength: cfg.frameLength,
    ...opts,
  });
}

/**
 * Build a vendor end-of-workout summary frame (`0xAA 0x86 0x7D 0x01`, 140 bytes).
 *
 * Field positions follow `TELEMETRY_CONFIG.vendorMessages.subTypes.summary.fields`.
 * Sender/receiver defaults to `DEVICE_TO_APP`. Bytes after the documented fields
 * (frame offset 18+) are zero-padded — the device emits aggregate stats there
 * but the layout is not yet decoded.
 */
export function buildVendorSummaryFrame(
  fields: {
    setCounter: number;
    repCount: number;
  },
  opts: FrameOpts = {}
): Uint8Array {
  const cfg = VENDOR_MESSAGES.subTypes.summary;
  const payloadSize = cfg.frameLength - 13;
  const payload = new Uint8Array(payloadSize);

  // 3-byte sub-type identifier at payload offset 0–2.
  payload[0] = cfg.identifierBytes[0];
  payload[1] = cfg.identifierBytes[1];
  payload[2] = cfg.identifierBytes[2];

  payload[cfg.fields.setCounter.payloadOffset] = fields.setCounter & 0xff;

  // repCount is big-endian (consistent with the prior repSet convention).
  const off = cfg.fields.repCount.payloadOffset;
  payload[off] = (fields.repCount >> 8) & 0xff;
  payload[off + 1] = fields.repCount & 0xff;

  return buildEnvelopedFrame(VENDOR_MESSAGES.cmdValue, payload, {
    senderReceiver: DEVICE_TO_APP,
    totalLength: cfg.frameLength,
    ...opts,
  });
}

// =============================================================================
// Vendor messages — raw payload (rowing PR 3, isometric PR 4)
// =============================================================================

export type RawVendorSubType = 'rowing' | 'isometricSummary' | 'isometricWaveform';

/**
 * Build a vendor frame for a sub-type whose field layout is not yet validated.
 * Caller supplies the payload bytes following the sub-type identifier; the
 * factory adds the envelope + sub-type identifier + CRC.
 *
 * `totalLength` defaults to the metadata's `frameLength` if non-null,
 * otherwise to the minimum size needed for the supplied payload.
 */
export function buildVendorRawFrame(
  subType: RawVendorSubType,
  payloadAfterIdentifier: Uint8Array,
  opts: FrameOpts = {}
): Uint8Array {
  const cfg = VENDOR_MESSAGES.subTypes[subType];
  const idLen = cfg.identifierBytes.length;
  const fullPayload = new Uint8Array(idLen + payloadAfterIdentifier.length);
  for (let i = 0; i < idLen; i++) fullPayload[i] = cfg.identifierBytes[i];
  fullPayload.set(payloadAfterIdentifier, idLen);

  const desiredLen = cfg.frameLength ?? undefined;
  return buildEnvelopedFrame(VENDOR_MESSAGES.cmdValue, fullPayload, {
    senderReceiver: DEVICE_TO_APP,
    totalLength: desiredLen,
    ...opts,
  });
}
