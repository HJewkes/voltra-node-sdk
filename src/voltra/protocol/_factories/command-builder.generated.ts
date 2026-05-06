// @generated — do not edit. Regenerate: npm run build (from voltra-private)
/**
 * Generic Command Builder
 *
 * Builds parametric commands following the official frame structure from Beyond Power:
 *   [Header 10B][CmdID 1B][Reserved 2B][Param_id 2B][Val NB][CRC16 2B]
 *   N = 2 for uint16/int16, 4 for uint32/int32
 *   Total = 17 + N
 */

import { calculateCRC8, calculateCRC16 } from './checksum.generated';
// bytesToHex inlined from voltra-private/src/utils.ts:
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Inlined from voltra-private/src/protocol/enums.ts (type-only, no runtime impact).
type ValueType = 'uint8' | 'uint16' | 'int16' | 'uint32' | 'int32';
interface ParamDefinition {
  readonly id: number;
  readonly name: string;
  readonly valueType: ValueType;
}


// =============================================================================
// Frame Constants
// =============================================================================

// Universal header: [0x55, frameLength, category, CRC8(bytes 0-2)]
// Byte 0: 0x55 start marker (fixed)
// Byte 1: total frame length (derived at build time)
// Byte 2: command category (0x04 for standard parametric commands)
// Byte 3: CRC8 of bytes 0-2 (header integrity checksum, computed at build time)
const START_MARKER = 0x55;
const CATEGORY = 0x04; // standard command category
const HEADER_BYTES_4_5 = [0xaa, 0x10] as const;
const HEADER_SUFFIX = [0x20, 0x00] as const; // bytes 8-9
const CMD_ID = 0x11;
const RESERVED = [0x01, 0x00] as const;

/** Default sequence base used for all generated commands */
export const BASE_SEQ = 0x2000;

// =============================================================================
// Builder
// =============================================================================

function valSize(vt: ValueType): 1 | 2 | 4 {
  if (vt === 'uint8') return 1;
  if (vt === 'uint16' || vt === 'int16') return 2;
  return 4;
}

/**
 * Build the shared command frame: header + CmdID + reserved + param + value + CRC16.
 */
function buildFrame(
  param: ParamDefinition,
  value: number,
  sequence: number,
  cmdId: number,
  reserved: readonly [number, number],
): Uint8Array {
  const vs = valSize(param.valueType);
  const totalSize = 17 + vs;
  const cmd = new Uint8Array(totalSize);

  cmd[0] = START_MARKER;
  cmd[1] = totalSize;
  cmd[2] = CATEGORY;
  cmd[3] = calculateCRC8(cmd.subarray(0, 3));
  cmd.set(HEADER_BYTES_4_5, 4);
  cmd[6] = sequence & 0xff;
  cmd[7] = (sequence >> 8) & 0xff;
  cmd.set(HEADER_SUFFIX, 8);

  cmd[10] = cmdId;
  cmd[11] = reserved[0];
  cmd[12] = reserved[1];

  cmd[13] = (param.id >> 8) & 0xff;
  cmd[14] = param.id & 0xff;

  const encoded =
    param.valueType.startsWith('int') && value < 0
      ? vs === 2
        ? 0x10000 + value
        : 0x100000000 + value
      : value;
  for (let i = 0; i < vs; i++) {
    cmd[15 + i] = (encoded >> (8 * i)) & 0xff;
  }

  const crc = calculateCRC16(cmd.subarray(0, totalSize - 2));
  cmd[totalSize - 2] = crc & 0xff;
  cmd[totalSize - 1] = (crc >> 8) & 0xff;

  return cmd;
}

/**
 * Build a parametric command hex string.
 *
 * Uses CmdID 0x11 (set parameter) with reserved [0x01, 0x00].
 *
 * @param param - Parameter definition (register ID + value type)
 * @param value - Value to encode (handles signed via two's complement)
 * @param sequence - Sequence number (bytes 6-7, LE uint16)
 * @returns Lowercase hex string of the complete command
 */
export function buildCommand(
  param: ParamDefinition,
  value: number,
  sequence: number,
): string {
  return bytesToHex(buildFrame(param, value, sequence, CMD_ID, RESERVED));
}

/**
 * Build a parametric command as Uint8Array (same as buildCommand but returns bytes).
 */
export function buildCommandBytes(
  param: ParamDefinition,
  value: number,
  sequence: number,
): Uint8Array {
  return buildFrame(param, value, sequence, CMD_ID, RESERVED);
}

/**
 * Build a "configure" command using CmdID 0x0f and reserved [0x02, 0x00].
 *
 * Observed in the workout SETUP command targeting register 0x6a50.
 * Different from standard parametric commands which use CmdID 0x11.
 *
 * @param param - Parameter definition (register ID + value type)
 * @param value - Value to encode
 * @param sequence - Sequence number (bytes 6-7, LE uint16)
 * @returns Command bytes
 */
export function buildConfigCommand(
  param: ParamDefinition,
  value: number,
  sequence: number,
): Uint8Array {
  return buildFrame(param, value, sequence, 0x0f, [0x02, 0x00]);
}
