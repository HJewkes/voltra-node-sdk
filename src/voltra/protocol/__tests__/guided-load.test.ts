/**
 * Tests for the guided-load (direct-load, Phase 1g) protocol helpers.
 *
 * Covers:
 *   - `buildGuidedLoadTriggerFrame` matches an on-wire fixture.
 *   - `buildGuidedLoadStatusReadFrame` carries the cmd `0x0F` byte, paramID
 *     count, and the 4 specific paramIDs at the documented offsets.
 *   - `buildGuidedLoadExitFrame` writes the protocol data's exit mode value
 *     via cmd `0x11`.
 *   - `decodeGuidedLoadStatus` extracts the 4 status registers + the
 *     fitness-mode register from a multi-param / settings-update payload,
 *     respecting the uint8 vs uint16 sizing rules.
 */
import { describe, it, expect } from 'vitest';
import { bytesToHex, hexToBytes } from '../../../shared/utils';
import {
  buildGuidedLoadTriggerFrame,
  buildGuidedLoadStatusReadFrame,
  buildGuidedLoadExitFrame,
  decodeGuidedLoadStatus,
  GUIDED_LOAD_MODE_ARMED,
  GUIDED_LOAD_MODE_ACTIVE,
  GUIDED_LOAD_MODE_EXIT,
} from '../guided-load';
import { NotificationConfigs } from '../constants';
import protocolData from '../data/protocol-data.generated';
import type { ProtocolData } from '../types';

const { guidedLoad } = (protocolData as ProtocolData).commands;
const status = guidedLoad.statusFields;

describe('buildGuidedLoadTriggerFrame', () => {
  it('produces the on-wire fixture', () => {
    const frame = buildGuidedLoadTriggerFrame();
    expect(bytesToHex(frame)).toBe('550e0466aa1000202000aa125231');
  });

  it('is 14 bytes long with a 0xAA inner cmd and 0x12 payload', () => {
    const frame = buildGuidedLoadTriggerFrame();
    expect(frame.length).toBe(14);
    // Bytes 4-5: sender/receiver app->device 0xAA 0x10
    expect(frame[4]).toBe(0xaa);
    expect(frame[5]).toBe(0x10);
    // Byte 10: inner cmd 0xAA (CMD_VENDOR)
    expect(frame[10]).toBe(0xaa);
    // Byte 11: trigger payload 0x12
    expect(frame[11]).toBe(0x12);
  });

  it('honors a custom sequence number', () => {
    const frame = buildGuidedLoadTriggerFrame(0x4321);
    expect(frame[6]).toBe(0x21);
    expect(frame[7]).toBe(0x43);
    // CRCs differ from the default-sequence frame
    expect(bytesToHex(frame)).not.toBe('550e0466aa1000202000aa125231');
  });
});

describe('buildGuidedLoadStatusReadFrame', () => {
  it('uses cmd 0x0F (CMD_PARAM_READ) at offset 10', () => {
    const frame = buildGuidedLoadStatusReadFrame();
    expect(frame[10]).toBe(0x0f);
  });

  it('encodes a payload count of 4 followed by the 4 status paramIDs (LE)', () => {
    const frame = buildGuidedLoadStatusReadFrame();
    // payload begins at byte 11
    // bytes 11-12: count uint16 LE = 4
    expect(frame[11]).toBe(0x04);
    expect(frame[12]).toBe(0x00);
    const { primaryStatus, forceStatus, countdownMs, runtimeStatus } = guidedLoad.statusFields;
    const ids = [primaryStatus, forceStatus, countdownMs, runtimeStatus].join('');
    expect(bytesToHex(frame.slice(13, 21))).toBe(ids);
  });

  it('total frame length matches envelope + 10-byte payload', () => {
    const frame = buildGuidedLoadStatusReadFrame();
    expect(frame.length).toBe(23);
    expect(frame[1]).toBe(23);
  });
});

describe('buildGuidedLoadExitFrame', () => {
  it('writes the exit mode value to the mode register with cmd 0x11', () => {
    const frame = buildGuidedLoadExitFrame();
    // cmd byte
    expect(frame[10]).toBe(0x11);
    // reserved [0x01, 0x00]
    expect(frame[11]).toBe(0x01);
    expect(frame[12]).toBe(0x00);
    expect(Array.from(frame.slice(13, 15))).toEqual(Array.from(hexToBytes(guidedLoad.modeField)));
    expect(frame[15]).toBe(GUIDED_LOAD_MODE_EXIT & 0xff);
    expect(frame[16]).toBe(GUIDED_LOAD_MODE_EXIT >> 8);
  });

  it('exposes the mode-register values the protocol data lists', () => {
    expect(GUIDED_LOAD_MODE_ARMED).toBe(guidedLoad.modes.armed);
    expect(GUIDED_LOAD_MODE_ACTIVE).toBe(guidedLoad.modes.active);
    expect(GUIDED_LOAD_MODE_EXIT).toBe(guidedLoad.modes.exit);
    expect(
      new Set([GUIDED_LOAD_MODE_ARMED, GUIDED_LOAD_MODE_ACTIVE, GUIDED_LOAD_MODE_EXIT]).size
    ).toBe(3);
  });
});

// =============================================================================
// decodeGuidedLoadStatus — multi-param payload decoder
// =============================================================================

/**
 * Build a multi-param notification carrying the supplied paramId/value
 * pairs. Mirrors `createSettingsUpdateBuffer` in `telemetry-decoder.test.ts`
 * but defaults to the `multiParam` (header 0x5516) variant.
 */
function buildMultiParamPayload(
  params: Array<{ paramIdLeHex: string; value: number; uint16: boolean }>,
  variant: 'multiParam' | 'settingsUpdate' = 'multiParam'
): Uint8Array {
  const cfg =
    variant === 'multiParam' ? NotificationConfigs.multiParam : NotificationConfigs.settingsUpdate;

  // Compute total length: largest of (configured length, end of last param).
  let payloadLen = cfg.firstParamOffset!;
  for (const p of params) {
    payloadLen += 2 + (p.uint16 ? 2 : 1);
  }
  const total = Math.max(cfg.length ?? 0, payloadLen);
  const buf = new Uint8Array(total);

  // Header (2 bytes)
  const header = cfg.header.match(/.{2}/g)!.map((b) => parseInt(b, 16));
  buf[0] = header[0];
  buf[1] = header[1];

  buf[cfg.paramCountOffset!] = params.length;

  let offset = cfg.firstParamOffset!;
  for (const p of params) {
    // paramId LE bytes
    const id = p.paramIdLeHex.match(/.{2}/g)!.map((b) => parseInt(b, 16));
    buf[offset] = id[0];
    buf[offset + 1] = id[1];
    offset += 2;
    if (p.uint16) {
      buf[offset] = p.value & 0xff;
      buf[offset + 1] = (p.value >> 8) & 0xff;
      offset += 2;
    } else {
      buf[offset] = p.value & 0xff;
      offset += 1;
    }
  }
  return buf;
}

describe('decodeGuidedLoadStatus', () => {
  it('returns null on a payload that is not a multi-param notification', () => {
    expect(decodeGuidedLoadStatus(new Uint8Array([0x55, 0x12, 0x00, 0x00]))).toBeNull();
  });

  it('returns null when no guided-load paramIds are present', () => {
    const buf = buildMultiParamPayload([
      { paramIdLeHex: '3e86', value: 50, uint16: false }, // baseWeight - not GL
    ]);
    expect(decodeGuidedLoadStatus(buf)).toBeNull();
  });

  it('decodes primaryStatus (uint8)', () => {
    const buf = buildMultiParamPayload([
      { paramIdLeHex: status.primaryStatus, value: 1, uint16: false },
    ]);
    const out = decodeGuidedLoadStatus(buf);
    expect(out).not.toBeNull();
    expect(out!.primaryStatus).toBe(1);
    expect(out!.forceStatus).toBeUndefined();
  });

  it('decodes countdownMs (uint16 LE) — 3000ms fits, 3 does not', () => {
    const buf = buildMultiParamPayload([
      { paramIdLeHex: status.countdownMs, value: 3000, uint16: true },
    ]);
    const out = decodeGuidedLoadStatus(buf);
    expect(out).not.toBeNull();
    expect(out!.countdownMs).toBe(3000);
  });

  it('decodes the 4 status registers + fitness-mode raw simultaneously', () => {
    const buf = buildMultiParamPayload([
      { paramIdLeHex: status.primaryStatus, value: 1, uint16: false },
      { paramIdLeHex: status.forceStatus, value: 2, uint16: false },
      { paramIdLeHex: status.countdownMs, value: 1500, uint16: true },
      { paramIdLeHex: status.runtimeStatus, value: 0, uint16: false },
      { paramIdLeHex: guidedLoad.modeField, value: GUIDED_LOAD_MODE_ARMED, uint16: true },
    ]);
    const out = decodeGuidedLoadStatus(buf);
    expect(out).toEqual({
      primaryStatus: 1,
      forceStatus: 2,
      countdownMs: 1500,
      runtimeStatus: 0,
      fitnessModeRaw: GUIDED_LOAD_MODE_ARMED,
    });
  });

  it('decodes from the settings_update variant header (0x2e) too', () => {
    const buf = buildMultiParamPayload(
      [{ paramIdLeHex: guidedLoad.modeField, value: GUIDED_LOAD_MODE_ACTIVE, uint16: true }],
      'settingsUpdate'
    );
    const out = decodeGuidedLoadStatus(buf);
    expect(out).not.toBeNull();
    expect(out!.fitnessModeRaw).toBe(GUIDED_LOAD_MODE_ACTIVE);
  });
});
