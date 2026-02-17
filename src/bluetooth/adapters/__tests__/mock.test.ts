/**
 * MockBLEAdapter Tests
 *
 * Verifies connection lifecycle, telemetry simulation, phase transitions,
 * rep/set boundaries, fatigue model, and config overrides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockBLEAdapter } from '../mock';
import { decodeTelemetryFrame } from '../../../voltra/protocol/telemetry-decoder';
import { MessageTypes } from '../../../voltra/protocol/constants/message-types';
import { MovementPhase } from '../../../voltra/protocol/constants/enums';
import { bytesEqual } from '../../../shared/utils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// Helpers
// =============================================================================

function collectNotifications(adapter: MockBLEAdapter): Uint8Array[] {
  const notifications: Uint8Array[] = [];
  adapter.onNotification((data) => notifications.push(data));
  return notifications;
}

function isTelemetryFrame(data: Uint8Array): boolean {
  return data.length === 30 && bytesEqual(data.subarray(0, 4), MessageTypes.TELEMETRY_STREAM);
}

function isRepBoundary(data: Uint8Array): boolean {
  return data.length === 4 && bytesEqual(data, MessageTypes.REP_SUMMARY);
}

function isSetBoundary(data: Uint8Array): boolean {
  return data.length === 4 && bytesEqual(data, MessageTypes.SET_SUMMARY);
}

/** Advance timers through N interval ticks (91ms each). */
function tickSamples(n: number): void {
  for (let i = 0; i < n; i++) {
    vi.advanceTimersByTime(91);
  }
}

// One full rep cycle: IDLE(5) + CONCENTRIC(9) + HOLD(2) + ECCENTRIC(16) = 32 samples
const SAMPLES_PER_REP = 5 + 9 + 2 + 16;

// =============================================================================
// Connection Lifecycle
// =============================================================================

describe('MockBLEAdapter', () => {
  describe('scan()', () => {
    it('returns a single mock device', async () => {
      const adapter = new MockBLEAdapter();
      const scanPromise = adapter.scan(5);
      vi.advanceTimersByTime(200);
      const devices = await scanPromise;

      expect(devices).toHaveLength(1);
      expect(devices[0]).toEqual({
        id: 'mock-voltra-001',
        name: 'VTR-Mock',
        rssi: -50,
      });
    });

    it('uses custom device name and id from config', async () => {
      const adapter = new MockBLEAdapter({ deviceName: 'VTR-Custom', deviceId: 'custom-id' });
      const scanPromise = adapter.scan(5);
      vi.advanceTimersByTime(200);
      const devices = await scanPromise;

      expect(devices[0].id).toBe('custom-id');
      expect(devices[0].name).toBe('VTR-Custom');
    });

    it('respects configured scanDelayMs', async () => {
      const adapter = new MockBLEAdapter({ scanDelayMs: 500 });
      const start = Date.now();

      const scanPromise = adapter.scan(5);
      vi.advanceTimersByTime(500);
      await scanPromise;

      // Should have waited ~500ms (fake time)
      expect(Date.now() - start).toBeGreaterThanOrEqual(500);
    });
  });

  describe('connect()', () => {
    it('transitions through connecting → connected', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 100 });
      const states: string[] = [];
      adapter.onConnectionStateChange((s) => states.push(s));

      const connectPromise = adapter.connect('mock-voltra-001');
      expect(states).toEqual(['connecting']);

      vi.advanceTimersByTime(100);
      await connectPromise;
      expect(states).toEqual(['connecting', 'connected']);
    });

    it('starts emitting telemetry after connection', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const connectPromise = adapter.connect('mock-voltra-001');
      vi.advanceTimersByTime(0);
      await connectPromise;

      tickSamples(5);
      expect(notifications.length).toBeGreaterThan(0);
      expect(isTelemetryFrame(notifications[0])).toBe(true);
    });
  });

  describe('write()', () => {
    it('resolves without error', async () => {
      const adapter = new MockBLEAdapter();
      await expect(adapter.write(new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
    });
  });

  describe('disconnect()', () => {
    it('sets state to disconnected and stops telemetry', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const connectPromise = adapter.connect('mock-voltra-001');
      vi.advanceTimersByTime(0);
      await connectPromise;

      await adapter.disconnect();
      expect(adapter.getConnectionState()).toBe('disconnected');

      const countAfterDisconnect = notifications.length;
      tickSamples(10);
      expect(notifications.length).toBe(countAfterDisconnect);
    });
  });

  // ===========================================================================
  // Telemetry Frames
  // ===========================================================================

  describe('telemetry frames', () => {
    it('emits valid 30-byte encoded frames decodable by decodeTelemetryFrame()', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(10);

      const telemetry = notifications.filter(isTelemetryFrame);
      expect(telemetry.length).toBeGreaterThanOrEqual(10);

      for (const data of telemetry) {
        const frame = decodeTelemetryFrame(data);
        expect(frame).not.toBeNull();
      }

      await adapter.disconnect();
    });

    it('has incrementing sequence numbers', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(10);
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      for (let i = 1; i < frames.length; i++) {
        expect(frames[i].sequence).toBe(frames[i - 1].sequence + 1);
      }
    });
  });

  // ===========================================================================
  // Phase Transitions
  // ===========================================================================

  describe('phase transitions', () => {
    it('follows IDLE → CONCENTRIC → HOLD → ECCENTRIC cycle', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      // Run through one full rep cycle
      tickSamples(SAMPLES_PER_REP);
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);

      // Extract unique phase sequence (consecutive deduped)
      const phaseSequence: MovementPhase[] = [];
      for (const f of frames) {
        if (phaseSequence.length === 0 || phaseSequence[phaseSequence.length - 1] !== f.phase) {
          phaseSequence.push(f.phase);
        }
      }

      expect(phaseSequence).toEqual([
        MovementPhase.IDLE,
        MovementPhase.CONCENTRIC,
        MovementPhase.HOLD,
        MovementPhase.ECCENTRIC,
      ]);
    });

    it('emits correct sample counts per phase', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(SAMPLES_PER_REP);
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      const phaseCounts = { idle: 0, concentric: 0, hold: 0, eccentric: 0 };

      for (const f of frames) {
        switch (f.phase) {
          case MovementPhase.IDLE:
            phaseCounts.idle++;
            break;
          case MovementPhase.CONCENTRIC:
            phaseCounts.concentric++;
            break;
          case MovementPhase.HOLD:
            phaseCounts.hold++;
            break;
          case MovementPhase.ECCENTRIC:
            phaseCounts.eccentric++;
            break;
        }
      }

      expect(phaseCounts.idle).toBe(5);
      expect(phaseCounts.concentric).toBe(9);
      expect(phaseCounts.hold).toBe(2);
      expect(phaseCounts.eccentric).toBe(16);
    });
  });

  // ===========================================================================
  // Frame Values
  // ===========================================================================

  describe('frame values', () => {
    it('concentric frames have increasing position 0→600', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(SAMPLES_PER_REP);
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      const concentric = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);

      expect(concentric[0].position).toBe(0);
      for (let i = 1; i < concentric.length; i++) {
        expect(concentric[i].position).toBeGreaterThanOrEqual(concentric[i - 1].position);
      }
    });

    it('eccentric frames have decreasing position 600→0', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(SAMPLES_PER_REP);
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      const eccentric = frames.filter((f) => f.phase === MovementPhase.ECCENTRIC);

      for (let i = 1; i < eccentric.length; i++) {
        expect(eccentric[i].position).toBeLessThanOrEqual(eccentric[i - 1].position);
      }
    });

    it('hold frames have position at max (600)', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(SAMPLES_PER_REP);
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      const hold = frames.filter((f) => f.phase === MovementPhase.HOLD);

      for (const f of hold) {
        expect(f.position).toBe(600);
      }
    });

    it('idle frames have zero position, force, and velocity', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(5); // Just the idle phase
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      const idle = frames.filter((f) => f.phase === MovementPhase.IDLE);

      for (const f of idle) {
        expect(f.position).toBe(0);
        expect(f.force).toBe(0);
        expect(f.velocity).toBe(0);
      }
    });

    it('concentric velocity follows a sine curve (peaks in the middle)', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(SAMPLES_PER_REP);
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      const concentric = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);
      const velocities = concentric.map((f) => f.velocity);

      // First sample is at progress=0 so sin(0)=0 → velocity 0
      expect(velocities[0]).toBe(0);

      // Middle samples should be highest
      const midIndex = Math.floor(velocities.length / 2);
      expect(velocities[midIndex]).toBeGreaterThan(velocities[0]);
      expect(velocities[midIndex]).toBeGreaterThan(velocities[velocities.length - 1]);
    });
  });

  // ===========================================================================
  // Rep & Set Boundaries
  // ===========================================================================

  describe('rep boundaries', () => {
    it('emits REP_SUMMARY after each rep cycle', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0, repsPerSet: 3 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      // Run 2 full rep cycles
      tickSamples(SAMPLES_PER_REP * 2);
      await adapter.disconnect();

      const repBoundaries = notifications.filter(isRepBoundary);
      expect(repBoundaries).toHaveLength(2);
    });
  });

  describe('set boundaries', () => {
    it('emits SET_SUMMARY after repsPerSet reps', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0, repsPerSet: 2 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      // 2 reps should trigger one set boundary
      tickSamples(SAMPLES_PER_REP * 2);
      await adapter.disconnect();

      const setBoundaries = notifications.filter(isSetBoundary);
      expect(setBoundaries).toHaveLength(1);
    });

    it('does not emit SET_SUMMARY before repsPerSet is reached', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0, repsPerSet: 5 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      // Only 3 reps — no set boundary yet
      tickSamples(SAMPLES_PER_REP * 3);
      await adapter.disconnect();

      const setBoundaries = notifications.filter(isSetBoundary);
      expect(setBoundaries).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Fatigue Model
  // ===========================================================================

  describe('fatigue', () => {
    it('concentric velocity decreases across reps within a set', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0, repsPerSet: 3 });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(SAMPLES_PER_REP * 3);
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);

      // Group concentric frames by rep (each rep has 9 concentric samples)
      const concentricByRep: number[][] = [];
      let currentRep: number[] = [];
      let lastPhase: MovementPhase | null = null;

      for (const f of frames) {
        if (f.phase === MovementPhase.CONCENTRIC) {
          if (lastPhase !== MovementPhase.CONCENTRIC && currentRep.length > 0) {
            concentricByRep.push(currentRep);
            currentRep = [];
          }
          currentRep.push(f.velocity);
        }
        lastPhase = f.phase;
      }
      if (currentRep.length > 0) concentricByRep.push(currentRep);

      // Peak velocity of each rep should decrease
      const peaks = concentricByRep.map((rep) => Math.max(...rep));
      for (let i = 1; i < peaks.length; i++) {
        expect(peaks[i]).toBeLessThan(peaks[i - 1]);
      }
    });
  });

  // ===========================================================================
  // Config
  // ===========================================================================

  describe('config', () => {
    it('uses default values when no config provided', () => {
      const adapter = new MockBLEAdapter();
      expect(adapter.getConnectionState()).toBe('disconnected');
    });

    it('weight affects force values', async () => {
      const lightAdapter = new MockBLEAdapter({ connectDelayMs: 0, weight: 50 });
      const heavyAdapter = new MockBLEAdapter({ connectDelayMs: 0, weight: 200 });

      const lightNotifications = collectNotifications(lightAdapter);
      const heavyNotifications = collectNotifications(heavyAdapter);

      const p1 = lightAdapter.connect('x');
      const p2 = heavyAdapter.connect('x');
      vi.advanceTimersByTime(0);
      await Promise.all([p1, p2]);

      tickSamples(SAMPLES_PER_REP);
      await Promise.all([lightAdapter.disconnect(), heavyAdapter.disconnect()]);

      const lightFrames = lightNotifications
        .filter(isTelemetryFrame)
        .map((d) => decodeTelemetryFrame(d)!);
      const heavyFrames = heavyNotifications
        .filter(isTelemetryFrame)
        .map((d) => decodeTelemetryFrame(d)!);

      const lightMaxForce = Math.max(...lightFrames.map((f) => f.force));
      const heavyMaxForce = Math.max(...heavyFrames.map((f) => f.force));

      expect(heavyMaxForce).toBeGreaterThan(lightMaxForce);
    });
  });
});
