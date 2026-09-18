/**
 * Parameter reports
 *
 * The device reports its registers in two shapes: one it sends when a value
 * changes, and one it sends in reply to a read. They differ in where the
 * entry list starts and in the reply's leading result byte; the entry list
 * itself is identical. Both go through the decoder here so the two paths
 * cannot disagree about a register's width or its sign.
 *
 * Widths come from the generated catalog, never from a guess. An entry whose
 * width the catalog does not carry ends the walk: the width decides where the
 * next entry begins, so assuming one would not lose a single value, it would
 * silently re-align every value after it. A decode that ends early says so
 * through `complete`, and the entries it did read stay usable.
 */

import { ParameterCatalog } from './constants';
import { bytesToHex } from '../../shared/utils';
import type { AsyncStateParam } from './types';

/** Trailing checksum bytes, which are never part of the entry list. */
const CRC_TRAILER_BYTES = 2;

/** Result value a read reply carries when the device honoured the read. */
const READ_RESULT_SUCCESS = 0;

/** Upper bound on entries walked, so a malformed count cannot spin. */
const MAX_ENTRIES = 16;

/**
 * Where a report keeps its entry list. `resultOffset` is present only on the
 * shape that reports whether the read succeeded.
 */
export interface ParameterReportLayout {
  /** Offset of the uint16 LE entry count. */
  countOffset: number;
  /** Offset of the first `<paramID><value>` entry. */
  firstParamOffset: number;
  /** Offset of the result byte, on the shapes that carry one. */
  resultOffset?: number;
}

/** A parameter report as decoded, whole or partial. */
export interface ParameterReport {
  /** Entry count the report declares, before any is decoded. */
  declaredCount: number;
  /** Entries decoded, in wire order. */
  params: AsyncStateParam[];
  /**
   * True when every declared entry decoded and the entry list ended exactly
   * where the frame does. False means the rest of the report was not read —
   * an unresolvable width, a truncated entry, or a refused read.
   */
  complete: boolean;
}

/** Byte width the device uses when it reports `paramIdHex`, or null. */
export function resolveReportWidth(paramIdHex: string): 1 | 2 | 4 | null {
  const entry = ParameterCatalog[paramIdHex];
  if (!entry) return null;
  return entry.reportValueWidth ?? entry.valueWidth;
}

/** True when the device reports `paramIdHex` as a signed value. */
function isSigned(paramIdHex: string): boolean {
  const entry = ParameterCatalog[paramIdHex];
  if (!entry) return false;
  const valueType = entry.reportValueType ?? entry.valueType;
  return valueType === 'int16' || valueType === 'int32';
}

/** Read one value of `width` bytes, little-endian, with its own signedness. */
function readValue(data: Uint8Array, offset: number, width: 1 | 2 | 4, paramIdHex: string): number {
  let value = 0;
  for (let i = 0; i < width; i++) {
    value += data[offset + i] << (i * 8);
  }
  value >>>= 0;
  if (!isSigned(paramIdHex)) return value;
  // 2 ** rather than a shift: a shift by 31 is itself signed in JS.
  const signBit = 2 ** (width * 8 - 1);
  return value >= signBit ? value - signBit * 2 : value;
}

/** True when a read reply says the device honoured the read. */
function readSucceeded(data: Uint8Array, layout: ParameterReportLayout): boolean {
  if (layout.resultOffset === undefined) return true;
  if (layout.resultOffset >= data.length) return false;
  return data[layout.resultOffset] === READ_RESULT_SUCCESS;
}

/**
 * Decode the entry list of a parameter report.
 *
 * Returns an empty, incomplete report for a refused read or a frame too
 * short to carry a count.
 */
export function decodeParameterReport(
  data: Uint8Array,
  layout: ParameterReportLayout
): ParameterReport {
  const end = data.length - CRC_TRAILER_BYTES;
  if (layout.countOffset + 2 > end || !readSucceeded(data, layout)) {
    return { declaredCount: 0, params: [], complete: false };
  }

  const declaredCount = data[layout.countOffset] | (data[layout.countOffset + 1] << 8);
  const params: AsyncStateParam[] = [];
  let offset = layout.firstParamOffset;

  for (let i = 0; i < declaredCount && i < MAX_ENTRIES; i++) {
    if (offset + 2 > end) break;
    const paramIdHex = bytesToHex(data.slice(offset, offset + 2));
    const byteLength = resolveReportWidth(paramIdHex);
    if (byteLength === null || offset + 2 + byteLength > end) break;
    const value = readValue(data, offset + 2, byteLength, paramIdHex);
    params.push({ paramIdHex, value, byteLength });
    offset += 2 + byteLength;
  }

  const complete = params.length === declaredCount && offset === end;
  return { declaredCount, params, complete };
}
