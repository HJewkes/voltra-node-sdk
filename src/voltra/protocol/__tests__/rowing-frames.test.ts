/**
 * Wire-byte tests for the rowing-frame builders (Bug 22).
 *
 * Verifies the EP_SCR_SWITCH and vendor-state-refresh frame layouts match
 * the validated envelopes documented in
 * voltra-private/research/rowing-protocol-2026-05-06-android-deep.md §9.
 */
import { describe, it, expect } from 'vitest';
import {
  ROW_START_ACTION_CODES,
  buildRowScrSwitchFrame,
  buildVendorStateRefreshFrame,
} from '../rowing-frames';

describe('rowing-frames', () => {
  describe('ROW_START_ACTION_CODES', () => {
    it('matches the Android-source action-code table', () => {
      // Cross-reference: rowing-protocol-2026-05-06-android-deep.md §2.
      expect(ROW_START_ACTION_CODES).toEqual({
        JustRow: 0x03,
        M50: 0x06,
        M100: 0x07,
        M500: 0x08,
        M1000: 0x09,
        M2000: 0x0a,
        M5000: 0x0b,
      });
    });
  });

  describe('buildRowScrSwitchFrame', () => {
    it('emits 21-byte frame matching envelope §9 E.4 (Just Row)', () => {
      const frame = buildRowScrSwitchFrame(ROW_START_ACTION_CODES.JustRow);
      expect(frame.length).toBe(0x15);
      // Header: 55 15 04 <crc8> AA 10 <seq> <seq> 20 00 11
      expect(frame[0]).toBe(0x55);
      expect(frame[1]).toBe(0x15);
      expect(frame[2]).toBe(0x04);
      expect(frame[4]).toBe(0xaa);
      expect(frame[5]).toBe(0x10);
      expect(frame[8]).toBe(0x20);
      expect(frame[9]).toBe(0x00);
      expect(frame[10]).toBe(0x11);
      // Payload: 01 00 65 51 03 3E 00 01
      expect(frame[11]).toBe(0x01);
      expect(frame[12]).toBe(0x00);
      expect(frame[13]).toBe(0x65);
      expect(frame[14]).toBe(0x51);
      expect(frame[15]).toBe(0x03);
      expect(frame[16]).toBe(0x3e);
      expect(frame[17]).toBe(0x00);
      expect(frame[18]).toBe(0x01);
      // Last 2 bytes are CRC16 — non-deterministic across sequence, but
      // present.
      expect(frame.length).toBe(21);
    });

    it('encodes the action byte at offset 15 for distance presets', () => {
      const cases: Array<[keyof typeof ROW_START_ACTION_CODES, number]> = [
        ['JustRow', 0x03],
        ['M50', 0x06],
        ['M100', 0x07],
        ['M500', 0x08],
        ['M1000', 0x09],
        ['M2000', 0x0a],
        ['M5000', 0x0b],
      ];
      for (const [preset, expected] of cases) {
        const frame = buildRowScrSwitchFrame(ROW_START_ACTION_CODES[preset]);
        expect(frame[15]).toBe(expected);
      }
    });

    it('respects the sequence override', () => {
      const a = buildRowScrSwitchFrame(0x03, { sequence: 0x1234 });
      expect(a[6]).toBe(0x34);
      expect(a[7]).toBe(0x12);
    });

    it('produces deterministic bytes for the same inputs', () => {
      const a = buildRowScrSwitchFrame(0x06, { sequence: 0x2000 });
      const b = buildRowScrSwitchFrame(0x06, { sequence: 0x2000 });
      expect(Array.from(a)).toEqual(Array.from(b));
    });
  });

  describe('buildVendorStateRefreshFrame', () => {
    it('emits 15-byte frame matching envelope §9 E.6', () => {
      const frame = buildVendorStateRefreshFrame();
      expect(frame.length).toBe(0x0f);
      expect(frame[0]).toBe(0x55);
      expect(frame[1]).toBe(0x0f);
      expect(frame[2]).toBe(0x04);
      expect(frame[4]).toBe(0xaa);
      expect(frame[5]).toBe(0x10);
      expect(frame[10]).toBe(0xaa);
      expect(frame[11]).toBe(0x13);
      expect(frame[12]).toBe(0x01);
    });
  });
});
