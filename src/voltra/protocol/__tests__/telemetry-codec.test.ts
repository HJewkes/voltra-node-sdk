/**
 * Telemetry Codec Tests
 *
 * Tests for encoding and decoding TelemetryFrames.
 * Critical for replay functionality - ensures roundtrip integrity.
 */

import { describe, it, expect } from 'vitest';
import { encodeTelemetryFrame, decodeTelemetryFrame } from '../telemetry-decoder';
import { createFrame } from '../../models/telemetry';
import { MovementPhase } from '../constants';

// =============================================================================
// Tests
// =============================================================================

describe('Telemetry Codec', () => {
  describe('encode → decode roundtrip', () => {
    it('preserves sequence', () => {
      const original = createFrame(12345, MovementPhase.IDLE, 0, 0, 0);

      const encoded = encodeTelemetryFrame(original);
      const decoded = decodeTelemetryFrame(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded!.sequence).toBe(12345);
    });

    it('preserves phase', () => {
      const phases = [
        MovementPhase.IDLE,
        MovementPhase.CONCENTRIC,
        MovementPhase.HOLD,
        MovementPhase.ECCENTRIC,
      ];

      for (const phase of phases) {
        const original = createFrame(1, phase, 100, 50, 100);
        const encoded = encodeTelemetryFrame(original);
        const decoded = decodeTelemetryFrame(encoded);

        expect(decoded).not.toBeNull();
        expect(decoded!.phase).toBe(phase);
      }
    });

    it('preserves position', () => {
      const positions = [0, 100, 300, 600];

      for (const position of positions) {
        const original = createFrame(1, MovementPhase.CONCENTRIC, position, 50, 100);
        const encoded = encodeTelemetryFrame(original);
        const decoded = decodeTelemetryFrame(encoded);

        expect(decoded).not.toBeNull();
        expect(decoded!.position).toBe(position);
      }
    });

    it('preserves velocity', () => {
      const velocities = [0, 100, 500, 1000];

      for (const velocity of velocities) {
        const original = createFrame(1, MovementPhase.CONCENTRIC, 300, 50, velocity);
        const encoded = encodeTelemetryFrame(original);
        const decoded = decodeTelemetryFrame(encoded);

        expect(decoded).not.toBeNull();
        expect(decoded!.velocity).toBe(velocity);
      }
    });

    it('preserves positive force values', () => {
      const forces = [0, 50, 100, 200];

      for (const force of forces) {
        const original = createFrame(1, MovementPhase.CONCENTRIC, 300, force, 100);
        const encoded = encodeTelemetryFrame(original);
        const decoded = decodeTelemetryFrame(encoded);

        expect(decoded).not.toBeNull();
        expect(decoded!.force).toBe(force);
      }
    });

    it('preserves negative velocity values (eccentric direction)', () => {
      const velocities = [-50, -100, -200, -1000];

      for (const velocity of velocities) {
        const original = createFrame(1, MovementPhase.ECCENTRIC, 300, 50, velocity);
        const encoded = encodeTelemetryFrame(original);
        const decoded = decodeTelemetryFrame(encoded);

        expect(decoded).not.toBeNull();
        expect(decoded!.velocity).toBe(velocity);
      }
    });

    it('handles complete frame with all fields', () => {
      const original = createFrame(
        9999, // sequence
        MovementPhase.ECCENTRIC, // phase
        450, // position
        75, // force (uint16 — non-negative, tenths of pounds)
        -250 // velocity (int16 — negative on eccentric direction)
      );

      const encoded = encodeTelemetryFrame(original);
      const decoded = decodeTelemetryFrame(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded!.sequence).toBe(9999);
      expect(decoded!.phase).toBe(MovementPhase.ECCENTRIC);
      expect(decoded!.position).toBe(450);
      expect(decoded!.force).toBe(75);
      expect(decoded!.velocity).toBe(-250);
    });
  });

  describe('edge cases', () => {
    it('handles maximum uint16 sequence', () => {
      const original = createFrame(65535, MovementPhase.IDLE, 0, 0, 0);
      const encoded = encodeTelemetryFrame(original);
      const decoded = decodeTelemetryFrame(encoded);

      expect(decoded!.sequence).toBe(65535);
    });

    it('handles zero values', () => {
      const original = createFrame(0, MovementPhase.IDLE, 0, 0, 0);
      const encoded = encodeTelemetryFrame(original);
      const decoded = decodeTelemetryFrame(encoded);

      expect(decoded!.sequence).toBe(0);
      expect(decoded!.position).toBe(0);
      expect(decoded!.force).toBe(0);
      expect(decoded!.velocity).toBe(0);
    });

    it('handles maximum position (600)', () => {
      const original = createFrame(1, MovementPhase.CONCENTRIC, 600, 50, 100);
      const encoded = encodeTelemetryFrame(original);
      const decoded = decodeTelemetryFrame(encoded);

      expect(decoded!.position).toBe(600);
    });

    it('handles maximum uint16 force', () => {
      // uint16 max is 65535; realistic force values are smaller, but the
      // decode contract is unsigned tenths of pounds.
      const original = createFrame(1, MovementPhase.CONCENTRIC, 300, 65000, 100);
      const encoded = encodeTelemetryFrame(original);
      const decoded = decodeTelemetryFrame(encoded);

      expect(decoded!.force).toBe(65000);
    });

    it('handles minimum int16 velocity (most negative)', () => {
      // int16 min is -32768; realistic velocity values are smaller, but the
      // decode contract is signed mm/s.
      const original = createFrame(1, MovementPhase.ECCENTRIC, 300, 50, -32768);
      const encoded = encodeTelemetryFrame(original);
      const decoded = decodeTelemetryFrame(encoded);

      expect(decoded!.velocity).toBe(-32768);
    });
  });

  describe('decodeTelemetryFrame()', () => {
    it('returns null for data shorter than 30 bytes', () => {
      const shortData = new Uint8Array(20);
      const decoded = decodeTelemetryFrame(shortData);

      expect(decoded).toBeNull();
    });

    it('assigns UNKNOWN phase for invalid phase byte', () => {
      // Create a valid 30-byte message manually
      const data = new Uint8Array(30);
      // Set message type header
      data[0] = 0x55;
      data[1] = 0x3a;
      data[2] = 0x04;
      data[3] = 0x70;
      // Set an invalid phase (phase is at byte 13)
      data[13] = 99; // Invalid phase value

      const decoded = decodeTelemetryFrame(data);

      expect(decoded).not.toBeNull();
      expect(decoded!.phase).toBe(MovementPhase.UNKNOWN);
    });
  });

  describe('encodeTelemetryFrame()', () => {
    it('produces 30-byte output', () => {
      const frame = createFrame(1, MovementPhase.IDLE, 0, 0, 0);
      const encoded = encodeTelemetryFrame(frame);

      expect(encoded.length).toBe(30);
    });

    it('sets correct message type header', () => {
      const frame = createFrame(1, MovementPhase.IDLE, 0, 0, 0);
      const encoded = encodeTelemetryFrame(frame);

      // Telemetry stream header: 0x553a0470
      expect(encoded[0]).toBe(0x55);
      expect(encoded[1]).toBe(0x3a);
      expect(encoded[2]).toBe(0x04);
      expect(encoded[3]).toBe(0x70);
    });
  });
});
