import { describe, it, expect } from 'vitest';
import {
  createFrame,
  isActivePhase,
  isConcentricPhase,
  isEccentricPhase,
  type TelemetryFrame,
} from '../telemetry/frame';
import { MovementPhase } from '../../protocol/constants';

function makeFrame(phase: MovementPhase): TelemetryFrame {
  return createFrame(1, phase, 100, 50, 200);
}

describe('frame', () => {
  // ===========================================================================
  // createFrame
  // ===========================================================================

  describe('createFrame', () => {
    it('creates a frame with the correct fields', () => {
      const frame = createFrame(42, MovementPhase.CONCENTRIC, 300, -50, 150);
      expect(frame.sequence).toBe(42);
      expect(frame.phase).toBe(MovementPhase.CONCENTRIC);
      expect(frame.position).toBe(300);
      expect(frame.force).toBe(-50);
      expect(frame.velocity).toBe(150);
    });

    it('includes a timestamp', () => {
      const before = Date.now();
      const frame = createFrame(1, MovementPhase.IDLE, 0, 0, 0);
      const after = Date.now();
      expect(frame.timestamp).toBeGreaterThanOrEqual(before);
      expect(frame.timestamp).toBeLessThanOrEqual(after);
    });

    it('handles zero values', () => {
      const frame = createFrame(0, MovementPhase.IDLE, 0, 0, 0);
      expect(frame.sequence).toBe(0);
      expect(frame.position).toBe(0);
      expect(frame.force).toBe(0);
      expect(frame.velocity).toBe(0);
    });
  });

  // ===========================================================================
  // isActivePhase
  // ===========================================================================

  describe('isActivePhase', () => {
    it('returns true for CONCENTRIC', () => {
      expect(isActivePhase(makeFrame(MovementPhase.CONCENTRIC))).toBe(true);
    });

    it('returns true for ECCENTRIC', () => {
      expect(isActivePhase(makeFrame(MovementPhase.ECCENTRIC))).toBe(true);
    });

    it('returns true for HOLD', () => {
      expect(isActivePhase(makeFrame(MovementPhase.HOLD))).toBe(true);
    });

    it('returns false for IDLE', () => {
      expect(isActivePhase(makeFrame(MovementPhase.IDLE))).toBe(false);
    });

    it('returns false for UNKNOWN', () => {
      expect(isActivePhase(makeFrame(MovementPhase.UNKNOWN))).toBe(false);
    });
  });

  // ===========================================================================
  // isConcentricPhase
  // ===========================================================================

  describe('isConcentricPhase', () => {
    it('returns true for CONCENTRIC', () => {
      expect(isConcentricPhase(makeFrame(MovementPhase.CONCENTRIC))).toBe(true);
    });

    it('returns false for ECCENTRIC', () => {
      expect(isConcentricPhase(makeFrame(MovementPhase.ECCENTRIC))).toBe(false);
    });

    it('returns false for IDLE', () => {
      expect(isConcentricPhase(makeFrame(MovementPhase.IDLE))).toBe(false);
    });

    it('returns false for HOLD', () => {
      expect(isConcentricPhase(makeFrame(MovementPhase.HOLD))).toBe(false);
    });

    it('returns false for UNKNOWN', () => {
      expect(isConcentricPhase(makeFrame(MovementPhase.UNKNOWN))).toBe(false);
    });
  });

  // ===========================================================================
  // isEccentricPhase
  // ===========================================================================

  describe('isEccentricPhase', () => {
    it('returns true for ECCENTRIC', () => {
      expect(isEccentricPhase(makeFrame(MovementPhase.ECCENTRIC))).toBe(true);
    });

    it('returns false for CONCENTRIC', () => {
      expect(isEccentricPhase(makeFrame(MovementPhase.CONCENTRIC))).toBe(false);
    });

    it('returns false for IDLE', () => {
      expect(isEccentricPhase(makeFrame(MovementPhase.IDLE))).toBe(false);
    });

    it('returns false for HOLD', () => {
      expect(isEccentricPhase(makeFrame(MovementPhase.HOLD))).toBe(false);
    });

    it('returns false for UNKNOWN', () => {
      expect(isEccentricPhase(makeFrame(MovementPhase.UNKNOWN))).toBe(false);
    });
  });
});
