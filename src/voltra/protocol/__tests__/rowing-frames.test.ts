/**
 * Wire-byte tests for the rowing-frame builders (Bug 22).
 *
 * Verifies the screen-switch and vendor-state-refresh frame layouts.
 */
import { describe, it, expect } from 'vitest';
import {
  ROW_START_ACTION_CODES,
  buildRowScrSwitchFrame,
  buildVendorStateRefreshFrame,
} from '../rowing-frames';

describe('rowing-frames', () => {
  describe('ROW_START_ACTION_CODES', () => {
    // The values themselves are pinned in rowing-frame-equivalence.test.ts.
    it('has one distinct code per preset', () => {
      const codes = Object.values(ROW_START_ACTION_CODES);

      expect(codes).toHaveLength(7);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  describe('buildRowScrSwitchFrame', () => {
    it('emits the 21-byte frame (Just Row)', () => {
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
      expect(frame[11]).toBe(0x01);
      expect(frame[12]).toBe(0x00);
      expect(frame[13]).toBe(0x65);
      expect(frame[14]).toBe(0x51);
      expect(frame[15]).toBe(ROW_START_ACTION_CODES.JustRow);
      expect(frame[16]).toBe(0x3e);
      expect(frame[17]).toBe(0x00);
      expect(frame[18]).toBe(0x01);
      // Last 2 bytes are CRC16 — non-deterministic across sequence, but
      // present.
      expect(frame.length).toBe(21);
    });

    it('encodes the action byte at offset 15 for distance presets', () => {
      for (const code of Object.values(ROW_START_ACTION_CODES)) {
        const frame = buildRowScrSwitchFrame(code);
        expect(frame[15]).toBe(code);
      }
    });

    it('respects the sequence override', () => {
      const a = buildRowScrSwitchFrame(ROW_START_ACTION_CODES.JustRow, { sequence: 0x1234 });
      expect(a[6]).toBe(0x34);
      expect(a[7]).toBe(0x12);
    });

    it('produces deterministic bytes for the same inputs', () => {
      const a = buildRowScrSwitchFrame(ROW_START_ACTION_CODES.M50, { sequence: 0x2000 });
      const b = buildRowScrSwitchFrame(ROW_START_ACTION_CODES.M50, { sequence: 0x2000 });
      expect(Array.from(a)).toEqual(Array.from(b));
    });
  });

  describe('buildVendorStateRefreshFrame', () => {
    it('emits the 15-byte frame', () => {
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
