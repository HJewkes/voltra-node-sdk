/**
 * Tests for connection-commands constants — particularly the on-wire byte
 * layout of `Workout.SETUP`, which Phase 0.5.2 reclassified as a
 * multi-paramID READ rather than a setter.
 */
import { describe, it, expect } from 'vitest';

import { Workout } from '../constants/connection-commands';

describe('Workout.SETUP — multi-paramID read envelope', () => {
  it('uses cmdID 0x0F (Type-C config envelope), not setter cmdID 0x11', () => {
    // Byte [10] is the cmd byte for the 19-byte parametric/config envelope.
    expect(Workout.SETUP[10]).toBe(0x0f);
    expect(Workout.SETUP[10]).not.toBe(0x11);
  });

  it('has reserved bytes [0x02, 0x00] at offsets [11..12]', () => {
    // The Type-C "config / multi-paramID read" envelope is identified by
    // cmdID 0x0F + reserved [0x02, 0x00]. cf. voltra-private docs:
    // protocol-reference.md § "Workout Control" + Type taxonomy table.
    expect(Workout.SETUP[11]).toBe(0x02);
    expect(Workout.SETUP[12]).toBe(0x00);
  });

  it('queries paramID MC_DEFAULT_OFFLEN_CM (0x506a) at offsets [13..14]', () => {
    // Param IDs are little-endian on the wire: 0x506a -> bytes `6a 50`.
    expect(Workout.SETUP[13]).toBe(0x6a);
    expect(Workout.SETUP[14]).toBe(0x50);
  });

  it('queries paramID BP_RUNTIME_POSITION_CM (0x3e82) at offsets [15..16]', () => {
    // Param IDs are little-endian on the wire: 0x3e82 -> bytes `82 3e`.
    expect(Workout.SETUP[15]).toBe(0x82);
    expect(Workout.SETUP[16]).toBe(0x3e);
  });

  it('matches the canonical 19-byte SETUP frame', () => {
    // Canonical bytes from voltra-private/docs/protocol-reference.md:
    // 55 13 04 03 aa 10 15 00 20 00 0f 02 00 6a 50 82 3e 8f 2f
    const expected = new Uint8Array([
      0x55, 0x13, 0x04, 0x03, 0xaa, 0x10, 0x15, 0x00, 0x20, 0x00, 0x0f, 0x02, 0x00, 0x6a, 0x50,
      0x82, 0x3e, 0x8f, 0x2f,
    ]);
    expect(Workout.SETUP.length).toBe(expected.length);
    expect(Array.from(Workout.SETUP)).toEqual(Array.from(expected));
  });
});
