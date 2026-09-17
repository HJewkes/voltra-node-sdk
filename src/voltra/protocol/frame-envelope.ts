/**
 * Frame Envelope
 *
 * Envelope-level validation shared by the notification path and the decoder.
 * Nothing here interprets a payload; it only answers "is there a whole,
 * intact frame starting here, and how long is it".
 *
 * The two checksum routines are the generated ones the builders use, so a
 * frame this module accepts is a frame those builders could have produced.
 */

import { calculateCRC8, calculateCRC16 } from './_factories/checksum.generated';

/** First byte of every frame in both directions. */
export const FRAME_MARKER = 0x55;

const HEADER_SIZE = 4;
const DECLARED_LENGTH_INDEX = 1;
const FRAME_TYPE_INDEX = 2;
const HEADER_CHECKSUM_INDEX = 3;
const TRAILER_SIZE = 2;
const MIN_FRAME_SIZE = HEADER_SIZE + TRAILER_SIZE;

/**
 * Frame types whose total size does not fit the single-byte length field.
 * The SDK does not model how they carry their size, so the notification path
 * hands them on untouched rather than guessing.
 */
const EXTENDED_LENGTH_FRAME_TYPES: ReadonlySet<number> = new Set([0x09]);

/**
 * Outcome of looking for a frame at `start`.
 *
 * `opaque` means a frame this module cannot size; `invalid` means the bytes
 * at `start` are not the beginning of one and the caller should resynchronise.
 */
export type EnvelopeScan =
  | { kind: 'frame'; length: number }
  | { kind: 'incomplete' }
  | { kind: 'opaque' }
  | { kind: 'invalid' };

const INCOMPLETE: EnvelopeScan = { kind: 'incomplete' };
const OPAQUE: EnvelopeScan = { kind: 'opaque' };
const INVALID: EnvelopeScan = { kind: 'invalid' };

/**
 * Scan for one whole frame beginning at `start`.
 *
 * Both checksums are verified: the header one before the declared length is
 * trusted, the whole-frame one before the frame is reported complete.
 */
export function scanEnvelope(data: Uint8Array, start = 0): EnvelopeScan {
  const available = data.length - start;
  if (available < HEADER_SIZE) return INCOMPLETE;
  if (data[start] !== FRAME_MARKER) return INVALID;

  if (EXTENDED_LENGTH_FRAME_TYPES.has(data[start + FRAME_TYPE_INDEX])) return OPAQUE;

  const headerChecksum = calculateCRC8(data.subarray(start, start + HEADER_CHECKSUM_INDEX));
  if (headerChecksum !== data[start + HEADER_CHECKSUM_INDEX]) return INVALID;

  const declared = data[start + DECLARED_LENGTH_INDEX];
  if (declared < MIN_FRAME_SIZE) return INVALID;
  if (available < declared) return INCOMPLETE;

  const end = start + declared;
  const expected = calculateCRC16(data.subarray(start, end - TRAILER_SIZE));
  const actual = data[end - TRAILER_SIZE] | (data[end - TRAILER_SIZE + 1] << 8);
  if (expected !== actual) return INVALID;

  return { kind: 'frame', length: declared };
}

/**
 * Stamp the declared length and both checksums onto a frame whose payload the
 * caller has already laid out, so {@link scanEnvelope} will accept it.
 *
 * For encoders and device simulators — the frame builders seal their own.
 * Returns the same array, sealed in place.
 */
export function sealEnvelope(frame: Uint8Array): Uint8Array {
  if (frame.length < MIN_FRAME_SIZE || frame.length > 0xff) {
    throw new Error(`sealEnvelope: ${frame.length} bytes cannot be a frame`);
  }
  frame[0] = FRAME_MARKER;
  frame[DECLARED_LENGTH_INDEX] = frame.length;
  frame[HEADER_CHECKSUM_INDEX] = calculateCRC8(frame.subarray(0, HEADER_CHECKSUM_INDEX));

  const checksum = calculateCRC16(frame.subarray(0, frame.length - TRAILER_SIZE));
  frame[frame.length - TRAILER_SIZE] = checksum & 0xff;
  frame[frame.length - TRAILER_SIZE + 1] = (checksum >> 8) & 0xff;
  return frame;
}
