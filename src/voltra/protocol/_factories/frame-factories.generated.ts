// @generated — do not edit. Regenerate: npm run build (from voltra-private)
/**
 * Frame Factories
 *
 * Test utilities that produce well-formed frames for any documented frame
 * type, so tests can express intent through a typed signature rather than a
 * magic hex string.
 *
 * Each factory's signature reflects the documented field shape. Factories for
 * types whose fields are not yet validated take a raw payload instead. All of
 * them accept `FrameOpts` for sequence number, length padding and
 * sender/receiver override.
 *
 * Factories are round-tripped against the same metadata decoders use, so a
 * silent drift on either side fails a test rather than shipping.
 */

import { calculateCRC8, calculateCRC16 } from './checksum.generated';
import { TELEMETRY_CONFIG } from './telemetry-config-source.generated';
export enum VendorSchemaVersion {
  Weight = 0x01,
  Band = 0x02,
  Damper = 0x03,
  Isokinetic = 0x04,
}

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
  /**
   * Sequence value for the frame.
   */
  sequence?: number;
  /**
   * Pad payload to hit this exact frame length. Defaults to the minimum size
   * for the supplied payload.
   */
  totalLength?: number;
  /**
   * Override the sender/receiver pair. Defaults to the direction expected for
   * the frame type — outbound (app→device) for commands, inbound (device→app)
   * for notifications and responses.
   */
  senderReceiver?: readonly [number, number];
}

// =============================================================================
// Generic envelope
// =============================================================================

/**
 * Build a frame with arbitrary cmd byte and payload, computing both CRCs.
 *
 * Default sender/receiver is `APP_TO_DEVICE`. Override via `opts.senderReceiver`.
 */
export function buildEnvelopedFrame(
  cmdId: number,
  payload: Uint8Array,
  opts: FrameOpts = {},
): Uint8Array {
  const sequence = opts.sequence ?? 0x2000;
  const senderReceiver = opts.senderReceiver ?? APP_TO_DEVICE;

  const minSize = 13 + payload.length;
  const totalSize = opts.totalLength ?? minSize;
  if (totalSize < minSize) {
    throw new Error(
      `frame-factories: totalLength=${totalSize} is smaller than required ${minSize} (envelope + payload)`,
    );
  }
  if (totalSize > 0xff) {
    throw new Error(
      `frame-factories: totalLength=${totalSize} exceeds the 1-byte length field (max 255)`,
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
  opts: FrameOpts = {},
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
// Identity response frames (inbound)
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
 * String payloads are encoded as ASCII and null-terminated. Pass a
 * `Uint8Array` directly to control the bytes exactly.
 */
export function buildIdentityResponseFrame(
  opcode: IdentityOpcodeKey,
  payload: Uint8Array | string,
  opts: FrameOpts = {},
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
      throw new Error(`frame-factories: non-ASCII char ${JSON.stringify(s[i])} in identity payload`);
    }
    out[i] = c;
  }
  out[s.length] = 0;
  return out;
}

// =============================================================================
// Vendor messages — typed (per-rep boundary + summary)
// =============================================================================

export type PerRepMotionPhase = 'pull' | 'return';

/**
 * Build a vendor per-rep boundary frame.
 *
 * Field positions and frame length come from the metadata rather than from
 * this file. Sender/receiver defaults to `DEVICE_TO_APP`.
 */
export function buildVendorPerRepFrame(
  fields: {
    motionPhase: PerRepMotionPhase | number;
    frameCounter: number;
    setCounter: number;
    repCount: number;
  },
  opts: FrameOpts = {},
): Uint8Array {
  const cfg = VENDOR_MESSAGES.subTypes.perRep;
  const payloadSize = cfg.frameLength - 13;
  const payload = new Uint8Array(payloadSize);

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
 * Build a vendor end-of-workout summary frame.
 *
 * The sub-type varies per mode; pass the matching `VendorSchemaVersion`. Field
 * positions and frame length come from the metadata rather than from this
 * file. Sender/receiver defaults to `DEVICE_TO_APP`; anything past the
 * documented fields is zero-padded.
 */
export function buildVendorSummaryFrame(
  fields: {
    schemaVersion: VendorSchemaVersion;
    setCounter: number;
    repCount: number;
  },
  opts: FrameOpts = {},
): Uint8Array {
  const cfg = VENDOR_MESSAGES.subTypes.summary;
  const payloadSize = cfg.frameLength - 13;
  const payload = new Uint8Array(payloadSize);

  payload[0] = cfg.identifierBytes[0];
  payload[1] = cfg.identifierBytes[1];
  payload[cfg.schemaVersionByteOffset] = fields.schemaVersion & 0xff;

  payload[cfg.fields.setCounter.payloadOffset] = fields.setCounter & 0xff;

  const off = cfg.fields.repCount.payloadOffset;
  payload[off] = fields.repCount & 0xff;
  payload[off + 1] = (fields.repCount >> 8) & 0xff;

  return buildEnvelopedFrame(VENDOR_MESSAGES.cmdValue, payload, {
    senderReceiver: DEVICE_TO_APP,
    totalLength: cfg.frameLength,
    ...opts,
  });
}

// =============================================================================
// Vendor messages — raw payload
// =============================================================================

export type RawVendorSubType = 'rowing' | 'isometricSummary' | 'isometricWaveform';

/**
 * Build a vendor frame for a sub-type whose field layout is not yet validated.
 * Caller supplies the payload bytes; the factory supplies everything the
 * metadata already describes.
 *
 * `totalLength` defaults to the metadata's `frameLength` if non-null,
 * otherwise to the minimum size needed for the supplied payload.
 */
export function buildVendorRawFrame(
  subType: RawVendorSubType,
  payloadAfterIdentifier: Uint8Array,
  opts: FrameOpts = {},
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
