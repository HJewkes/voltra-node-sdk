/**
 * One decoder reads both shapes of parameter report — the report the device
 * sends when a value changes, and the reply it sends to a read — so these
 * tests run the same cases through both paths wherever the case applies.
 *
 * Widths come from the generated catalog. The tests pick registers out of the
 * catalog by width rather than naming them, so a register moving between
 * widths cannot quietly turn a test into a different test.
 */

import { describe, it, expect } from 'vitest';
import { buildEnvelopedFrame } from '../_factories';
import { ParameterCatalog, ParamIdHex } from '../constants';
import {
  decodeAsyncState,
  decodeBulkParamResponse,
  decodeNotification,
  encodeBulkParamResponse,
} from '../telemetry-decoder';
import { hexToBytes } from '../../../shared/utils';

/** The device is the sender for every report. */
const DEVICE_TO_APP: readonly [number, number] = [0x10, 0xaa];
/** Cmd byte the change report carries. */
const CHANGE_REPORT_CMD = 0x10;

interface Entry {
  paramIdHex: string;
  value: number;
}

/** A register the catalog reports at `width` bytes, and does not project. */
function registerOfWidth(width: 1 | 2 | 4): string {
  const projected = new Set(Object.values(ParamIdHex));
  const match = Object.values(ParameterCatalog).find(
    (entry) =>
      (entry.reportValueWidth ?? entry.valueWidth) === width && !projected.has(entry.wireLE)
  );
  if (!match) throw new Error(`no unprojected register of width ${width} in the catalog`);
  return match.wireLE;
}

/** Bytes of one `<paramID><value>` entry, little-endian at its own width. */
function entryBytes({ paramIdHex, value }: Entry, width: number): number[] {
  const bytes = [...hexToBytes(paramIdHex)];
  for (let i = 0; i < width; i++) bytes.push((value >> (i * 8)) & 0xff);
  return bytes;
}

/** Width the catalog reports `paramIdHex` at; one byte for a register it
 * does not carry, which is what a stand-in device would send. */
function widthOf(paramIdHex: string): number {
  const entry = ParameterCatalog[paramIdHex];
  if (!entry) return 1;
  return entry.reportValueWidth ?? entry.valueWidth;
}

/** Build the report the device sends when values change. */
function buildChangeReport(entries: Entry[], declaredCount = entries.length): Uint8Array {
  const payload = [declaredCount & 0xff, (declaredCount >> 8) & 0xff];
  for (const entry of entries) payload.push(...entryBytes(entry, widthOf(entry.paramIdHex)));
  return buildEnvelopedFrame(CHANGE_REPORT_CMD, new Uint8Array(payload), {
    senderReceiver: DEVICE_TO_APP,
  });
}

describe('a parameter report of mixed widths', () => {
  it('keeps a later weight register aligned after 1-, 2- and 4-byte values', () => {
    const report = buildChangeReport([
      { paramIdHex: registerOfWidth(1), value: 9 },
      { paramIdHex: registerOfWidth(2), value: 4096 },
      { paramIdHex: registerOfWidth(4), value: 300000 },
      { paramIdHex: ParamIdHex.BASE_WEIGHT, value: 85 },
    ]);

    const decoded = decodeAsyncState(report);

    expect(decoded?.complete).toBe(true);
    expect(decoded?.params.at(-1)).toEqual({
      paramIdHex: ParamIdHex.BASE_WEIGHT,
      value: 85,
      byteLength: 2,
    });
  });

  it('reads the same widths out of a read reply', () => {
    const reply = encodeBulkParamResponse([
      { paramIdHex: registerOfWidth(1), value: 9 },
      { paramIdHex: registerOfWidth(4), value: 300000 },
      { paramIdHex: ParamIdHex.BASE_WEIGHT, value: 85 },
    ]);

    const decoded = decodeBulkParamResponse(reply);

    expect(decoded?.complete).toBe(true);
    expect(decoded?.settings.baseWeight).toBe(85);
  });
});

describe('a signed register', () => {
  it.each([-25, 0, 25])('keeps the sign of %i in a change report', (value) => {
    const report = buildChangeReport([{ paramIdHex: ParamIdHex.ECCENTRIC, value }]);

    const result = decodeNotification(report);

    expect(result?.type).toBe('settings_update');
    if (result?.type === 'settings_update') expect(result.settings.eccentric).toBe(value);
  });

  it.each([-25, 0, 25])('keeps the sign of %i in a read reply', (value) => {
    const reply = encodeBulkParamResponse([{ paramIdHex: ParamIdHex.ECCENTRIC, value }]);

    expect(decodeBulkParamResponse(reply)?.settings.eccentric).toBe(value);
  });
});

describe('a report the decoder cannot finish', () => {
  it('stops at a register with no width rather than assuming one', () => {
    const unknown = 'fdfd';
    expect(ParameterCatalog[unknown]).toBeUndefined();
    const report = buildChangeReport([
      { paramIdHex: ParamIdHex.BASE_WEIGHT, value: 60 },
      { paramIdHex: unknown, value: 1 },
    ]);

    const decoded = decodeAsyncState(report);

    expect(decoded?.complete).toBe(false);
    expect(decoded?.params).toEqual([
      { paramIdHex: ParamIdHex.BASE_WEIGHT, value: 60, byteLength: 2 },
    ]);
  });

  it('stops at a truncated entry and keeps what came before it', () => {
    const whole = buildChangeReport([
      { paramIdHex: ParamIdHex.BASE_WEIGHT, value: 60 },
      { paramIdHex: ParamIdHex.CHAINS, value: 20 },
    ]);
    // Cut the last entry's value short, checksum bytes and all.
    const truncated = whole.slice(0, whole.length - 3);

    const decoded = decodeAsyncState(truncated);

    expect(decoded?.complete).toBe(false);
    expect(decoded?.params).toEqual([
      { paramIdHex: ParamIdHex.BASE_WEIGHT, value: 60, byteLength: 2 },
    ]);
  });

  it('reads no entries out of a read the device refused', () => {
    const reply = encodeBulkParamResponse([{ paramIdHex: ParamIdHex.BASE_WEIGHT, value: 60 }]);
    const refused = Uint8Array.from(reply);
    refused[11] = 0x01;

    const decoded = decodeBulkParamResponse(refused);

    expect(decoded?.complete).toBe(false);
    expect(decoded?.paramCount).toBe(0);
    expect(decoded?.settings).toEqual({});
  });
});

describe('the battery register', () => {
  it('reaches device settings from a change report', () => {
    const report = buildChangeReport([{ paramIdHex: ParamIdHex.BATTERY!, value: 85 }]);

    const result = decodeNotification(report);

    expect(result?.type).toBe('settings_update');
    if (result?.type === 'settings_update') expect(result.settings.battery).toBe(85);
  });

  it('reaches device settings from a read reply', () => {
    const reply = encodeBulkParamResponse([{ paramIdHex: ParamIdHex.BATTERY!, value: 85 }]);

    expect(decodeBulkParamResponse(reply)?.settings.battery).toBe(85);
  });
});

/** The entry list cannot be encoded for a register with no width. */
describe('the device stand-in', () => {
  it('refuses to build a reply for a register with no width', () => {
    expect(() => encodeBulkParamResponse([{ paramIdHex: 'fdfd', value: 1 }])).toThrow();
  });
});
