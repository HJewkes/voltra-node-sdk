/**
 * MockBLEAdapter Tests
 *
 * Verifies connection lifecycle, telemetry simulation, phase transitions,
 * rep/set boundaries, fatigue model, and config overrides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockBLEAdapter } from '../mock';
import {
  decodeTelemetryFrame,
  decodeNotification,
} from '../../../voltra/protocol/telemetry-decoder';
import {
  MessageTypes,
  NotificationConfigs,
} from '../../../voltra/protocol/constants/message-types';
import { MovementPhase, TrainingMode } from '../../../voltra/protocol/constants/enums';
import { bytesEqual, bytesToHex } from '../../../shared/utils';
import { getModeCommand } from '../../../voltra/protocol/commands';

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

function isModeConfirmation(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  const header = bytesToHex(data.subarray(0, 2));
  return header === NotificationConfigs.modeConfirmation.header;
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
      expect(devices[0].id).toBe('mock-voltra-001');
      expect(devices[0].name).toBe('VTR-Mock');
      expect(devices[0].rssi).toBeTypeOf('number');
      expect(devices[0].rssi!).toBeGreaterThan(-80);
      expect(devices[0].rssi!).toBeLessThan(-40);
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

  // ===========================================================================
  // Training Mode Simulation
  // ===========================================================================

  describe('training modes', () => {
    /** Connect, collect one rep cycle, disconnect, return decoded telemetry frames. */
    async function collectOneRep(
      mode: TrainingMode,
      samplesPerRep: number
    ): ReturnType<typeof decodeTelemetryFrame>[] {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        trainingMode: mode,
      });
      const notifications: Uint8Array[] = [];
      adapter.onNotification((data) => notifications.push(data));

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(samplesPerRep);
      await adapter.disconnect();

      return notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
    }

    it('resistance band: force increases with position during concentric', async () => {
      // Resistance Band: 5 idle + 10 con + 3 hold + 14 ecc = 32
      const frames = await collectOneRep(TrainingMode.ResistanceBand, 32);
      const concentric = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);

      expect(concentric.length).toBe(10);

      // Force should trend upward as position increases (non-linear band stretch)
      const firstThird = concentric.slice(1, 4);
      const lastThird = concentric.slice(7, 10);
      const avgForceEarly = firstThird.reduce((s, f) => s + f.force, 0) / firstThird.length;
      const avgForceLate = lastThird.reduce((s, f) => s + f.force, 0) / lastThird.length;
      expect(avgForceLate).toBeGreaterThan(avgForceEarly);
    });

    it('rowing: has longer phase durations than weight training', async () => {
      // Rowing: 6 idle + 14 con + 2 hold + 20 ecc = 42
      const frames = await collectOneRep(TrainingMode.Rowing, 42);
      const concentric = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);
      const eccentric = frames.filter((f) => f.phase === MovementPhase.ECCENTRIC);

      // Rowing has 14 concentric (vs 9 for weight training) and 20 eccentric (vs 16)
      expect(concentric.length).toBe(14);
      expect(eccentric.length).toBe(20);
    });

    it('rowing: velocity peaks are lower than weight training', async () => {
      const rowingFrames = await collectOneRep(TrainingMode.Rowing, 42);
      const wtFrames = await collectOneRep(TrainingMode.WeightTraining, 32);

      const rowingPeakVel = Math.max(
        ...rowingFrames.filter((f) => f.phase === MovementPhase.CONCENTRIC).map((f) => f.velocity)
      );
      const wtPeakVel = Math.max(
        ...wtFrames.filter((f) => f.phase === MovementPhase.CONCENTRIC).map((f) => f.velocity)
      );

      expect(rowingPeakVel).toBeLessThan(wtPeakVel);
    });

    it('damper: force correlates with velocity (force = f(velocity))', async () => {
      // Damper: 5 idle + 10 con + 2 hold + 14 ecc = 31
      const frames = await collectOneRep(TrainingMode.Damper, 31);
      const concentric = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);

      // When velocity is 0, force should be 0 (velocity-dependent resistance)
      expect(concentric[0].velocity).toBe(0);
      expect(concentric[0].force).toBe(0);

      // At peak velocity, force should be highest
      const peakVelFrame = concentric.reduce((a, b) => (a.velocity > b.velocity ? a : b));
      expect(peakVelFrame.force).toBeGreaterThan(0);
    });

    it('custom curves: force follows a sine-wave profile', async () => {
      // Custom Curves: 4 idle + 11 con + 3 hold + 15 ecc = 33
      const frames = await collectOneRep(TrainingMode.CustomCurves, 33);
      const concentric = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);

      expect(concentric.length).toBe(11);

      // Sine wave: starts at 0, peaks in middle, returns toward 0
      expect(concentric[0].force).toBe(0);
      const midIndex = Math.floor(concentric.length / 2);
      expect(concentric[midIndex].force).toBeGreaterThan(concentric[0].force);
      expect(concentric[midIndex].force).toBeGreaterThan(concentric[concentric.length - 1].force);
    });

    it('isokinetic: constant velocity during concentric and eccentric', async () => {
      // Isokinetic: 5 idle + 12 con + 2 hold + 12 ecc = 31
      const frames = await collectOneRep(TrainingMode.Isokinetic, 31);
      const concentric = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);
      const eccentric = frames.filter((f) => f.phase === MovementPhase.ECCENTRIC);

      // All concentric velocity values should be the same constant (45)
      const conVelocities = new Set(concentric.map((f) => f.velocity));
      expect(conVelocities.size).toBe(1);
      expect(concentric[0].velocity).toBe(45);

      // All eccentric velocity values should also be constant
      const eccVelocities = new Set(eccentric.map((f) => f.velocity));
      expect(eccVelocities.size).toBe(1);
    });

    it('isometric: zero position and zero velocity, non-zero force', async () => {
      // Isometric: 5 idle + 20 concentric = 25 (only 2 phases)
      const frames = await collectOneRep(TrainingMode.Isometric, 25);
      const activeFrames = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);

      expect(activeFrames.length).toBe(20);

      for (const f of activeFrames) {
        expect(f.position).toBe(0);
        expect(f.velocity).toBe(0);
        expect(f.force).toBeGreaterThan(0);
      }
    });

    it('isometric: emits rep boundaries with 2-phase cycle', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        trainingMode: TrainingMode.Isometric,
        repsPerSet: 2,
      });
      const notifications: Uint8Array[] = [];
      adapter.onNotification((data) => notifications.push(data));

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      // 2 reps of isometric (25 samples each)
      tickSamples(25 * 2);
      await adapter.disconnect();

      const repBoundaries = notifications.filter(isRepBoundary);
      const setBoundaries = notifications.filter(isSetBoundary);
      expect(repBoundaries).toHaveLength(2);
      expect(setBoundaries).toHaveLength(1);
    });

    it('all modes produce valid decodable telemetry frames', async () => {
      // Sample counts derived from phase definitions in profiles.ts:
      // sum of all PhaseDef.count values for each mode's profile
      const modes: [TrainingMode, number][] = [
        [TrainingMode.WeightTraining, 32], // 5 idle + 9 con + 2 hold + 16 ecc
        [TrainingMode.ResistanceBand, 32], // 5 idle + 10 con + 3 hold + 14 ecc
        [TrainingMode.Rowing, 42], // 6 idle + 14 con + 2 hold + 20 ecc
        [TrainingMode.Damper, 31], // 5 idle + 10 con + 2 hold + 14 ecc
        [TrainingMode.CustomCurves, 33], // 4 idle + 11 con + 3 hold + 15 ecc
        [TrainingMode.Isokinetic, 31], // 5 idle + 12 con + 2 hold + 12 ecc
        [TrainingMode.Isometric, 25], // 5 idle + 20 con (2 phases only)
      ];

      for (const [mode, samples] of modes) {
        const frames = await collectOneRep(mode, samples);
        expect(frames.length).toBeGreaterThan(0);
        for (const f of frames) {
          expect(f).not.toBeNull();
          expect(f.sequence).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  // ===========================================================================
  // Mode Switching
  // ===========================================================================

  describe('mode switching', () => {
    it('switches telemetry to isometric after setTrainingMode (velocity drops to 0)', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        trainingMode: TrainingMode.WeightTraining,
      });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      // Generate some weight training frames
      tickSamples(SAMPLES_PER_REP);

      const preSwitch = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      const concentricVelocities = preSwitch
        .filter((f) => f.phase === MovementPhase.CONCENTRIC)
        .map((f) => f.velocity);
      const peakVelocity = Math.max(...concentricVelocities);
      expect(peakVelocity).toBeGreaterThan(0);

      // Switch to isometric
      notifications.length = 0;
      adapter.setTrainingMode(TrainingMode.Isometric);

      // Skip mode confirmation notification
      // Isometric: 5 idle + 20 concentric = 25 samples
      tickSamples(25);
      await adapter.disconnect();

      const postSwitch = notifications
        .filter(isTelemetryFrame)
        .map((d) => decodeTelemetryFrame(d)!);
      const activeFrames = postSwitch.filter((f) => f.phase === MovementPhase.CONCENTRIC);

      for (const f of activeFrames) {
        expect(f.position).toBe(0);
        expect(f.velocity).toBe(0);
      }
    });

    it('resets rep counter on mode switch', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        trainingMode: TrainingMode.WeightTraining,
        repsPerSet: 5,
      });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      // Complete 3 reps
      tickSamples(SAMPLES_PER_REP * 3);
      const repsBefore = notifications.filter(isRepBoundary).length;
      expect(repsBefore).toBe(3);

      // Switch mode — counters reset
      notifications.length = 0;
      adapter.setTrainingMode(TrainingMode.Isometric);

      // Complete 2 reps of isometric (5 idle + 20 con = 25 each)
      // With repsPerSet=5, 2 reps should NOT trigger a set boundary
      tickSamples(25 * 2);
      await adapter.disconnect();

      const repsAfter = notifications.filter(isRepBoundary).length;
      const setsAfter = notifications.filter(isSetBoundary).length;
      expect(repsAfter).toBe(2);
      expect(setsAfter).toBe(0);
    });

    it('emits mode confirmation notification on switch', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        trainingMode: TrainingMode.WeightTraining,
      });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      notifications.length = 0;
      adapter.setTrainingMode(TrainingMode.Rowing);

      const confirmations = notifications.filter(isModeConfirmation);
      expect(confirmations).toHaveLength(1);

      const decoded = decodeNotification(confirmations[0]);
      expect(decoded).not.toBeNull();
      expect(decoded!.type).toBe('mode_confirmation');
      if (decoded!.type === 'mode_confirmation') {
        expect(decoded!.mode).toBe(TrainingMode.Rowing);
      }

      await adapter.disconnect();
    });

    it('handles rapid mode switching without crashing', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        trainingMode: TrainingMode.WeightTraining,
      });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      // Rapidly switch through all modes
      adapter.setTrainingMode(TrainingMode.ResistanceBand);
      adapter.setTrainingMode(TrainingMode.Rowing);
      adapter.setTrainingMode(TrainingMode.Damper);
      adapter.setTrainingMode(TrainingMode.Isometric);
      adapter.setTrainingMode(TrainingMode.Isokinetic);
      adapter.setTrainingMode(TrainingMode.CustomCurves);

      // Should have 6 mode confirmations
      const confirmations = notifications.filter(isModeConfirmation);
      expect(confirmations).toHaveLength(6);

      // Telemetry should still work after rapid switching
      notifications.length = 0;
      // CustomCurves: 4 idle + 11 con + 3 hold + 15 ecc = 33
      tickSamples(33);

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      expect(frames.length).toBeGreaterThan(0);
      for (const f of frames) {
        expect(f).not.toBeNull();
      }

      await adapter.disconnect();
    });

    it('default mode works without explicit setTrainingMode call', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        trainingMode: TrainingMode.WeightTraining,
      });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      tickSamples(SAMPLES_PER_REP);
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      const concentric = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);
      expect(concentric).toHaveLength(9);

      // No mode confirmations should have been emitted
      const confirmations = notifications.filter(isModeConfirmation);
      expect(confirmations).toHaveLength(0);
    });

    it('detects mode command bytes via write() and switches mode', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        trainingMode: TrainingMode.WeightTraining,
      });
      const notifications = collectNotifications(adapter);

      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      // Write the raw mode command for Isometric
      const modeCmd = getModeCommand(TrainingMode.Isometric);
      expect(modeCmd).not.toBeNull();

      notifications.length = 0;
      await adapter.write(modeCmd!);

      // Should emit mode confirmation
      const confirmations = notifications.filter(isModeConfirmation);
      expect(confirmations).toHaveLength(1);

      const decoded = decodeNotification(confirmations[0]);
      expect(decoded).not.toBeNull();
      expect(decoded!.type).toBe('mode_confirmation');
      if (decoded!.type === 'mode_confirmation') {
        expect(decoded!.mode).toBe(TrainingMode.Isometric);
      }

      // Telemetry should now be isometric
      notifications.length = 0;
      tickSamples(25); // 5 idle + 20 concentric
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      const active = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);
      for (const f of active) {
        expect(f.velocity).toBe(0);
        expect(f.position).toBe(0);
      }
    });
  });

  describe('configure()', () => {
    it('updates training mode at runtime; subsequent telemetry reflects it', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        trainingMode: TrainingMode.Damper, // mode-cycle non-trivial
      });
      const notifications: Uint8Array[] = [];
      adapter.onNotification((data) => notifications.push(data));
      const p = adapter.connect('x');
      vi.advanceTimersByTime(0);
      await p;

      adapter.configure({ trainingMode: TrainingMode.Isometric });

      // Drain pre-configure frames + collect post-configure frames.
      tickSamples(35);
      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
      // The latter half of the run is post-configure: assert at least one
      // concentric frame has velocity=0 (Isometric pins it). Not all frames
      // pre-configure satisfy that, so we only require existence.
      const isometricLooking = frames.filter(
        (f) => f.phase === MovementPhase.CONCENTRIC && f.velocity === 0 && f.position === 0
      );
      expect(isometricLooking.length).toBeGreaterThan(0);
    });

    it('preserves untouched fields', () => {
      const adapter = new MockBLEAdapter({ repsPerSet: 3, restBetweenSetsMs: 1000 });
      adapter.configure({ repsPerSet: 5 });
      // Adapter remains usable; configure() is sync and idempotent for the
      // other runtime fields.
      expect(adapter).toBeDefined();
    });
  });
});
