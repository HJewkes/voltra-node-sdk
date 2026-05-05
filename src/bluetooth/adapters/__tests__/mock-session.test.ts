/**
 * MockBLEAdapter Session Config Tests
 *
 * Verifies multi-set simulation, pause sets, tempo overrides,
 * inter-set fatigue recovery, and session termination.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockBLEAdapter } from '../mock';
import { decodeTelemetryFrame } from '../../../voltra/protocol/telemetry-decoder';
import {
  MessageTypes,
  VendorMessages,
  matchesVendorSubType,
} from '../../../voltra/protocol/constants/message-types';
import { MovementPhase } from '../../../voltra/protocol/constants/enums';
import { bytesEqual } from '../../../shared/utils';
import {
  createMultiSetScenario,
  createPauseSetScenario,
  createTempoScenario,
  createShortRestScenario,
} from '../mock/session-config';

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
  return matchesVendorSubType(data, VendorMessages.subTypes.perRep);
}

function isSetBoundary(data: Uint8Array): boolean {
  return matchesVendorSubType(data, VendorMessages.subTypes.inProgress);
}

function tickSamples(n: number): void {
  for (let i = 0; i < n; i++) {
    vi.advanceTimersByTime(91);
  }
}

// Standard rep cycle: IDLE(5) + CONCENTRIC(9) + HOLD(2) + ECCENTRIC(16) = 32
const SAMPLES_PER_REP = 5 + 9 + 2 + 16;

async function connectAdapter(adapter: MockBLEAdapter): Promise<void> {
  const p = adapter.connect('x');
  vi.advanceTimersByTime(0);
  await p;
}

// =============================================================================
// Multi-set simulation
// =============================================================================

describe('MockBLEAdapter session config', () => {
  describe('multi-set simulation', () => {
    it('emits correct number of rep and set boundaries', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        sessionConfig: {
          sets: 3,
          repsPerSet: 2,
          restBetweenSetsMs: 100,
          interSetRecovery: 0.5,
        },
      });
      const notifications = collectNotifications(adapter);
      await connectAdapter(adapter);

      // 3 sets x 2 reps = 6 reps, with rest between sets
      for (let set = 0; set < 3; set++) {
        tickSamples(SAMPLES_PER_REP * 2);
        if (set < 2) {
          // Advance through rest period
          vi.advanceTimersByTime(100);
        }
      }

      await adapter.disconnect();

      const repBoundaries = notifications.filter(isRepBoundary);
      const setBoundaries = notifications.filter(isSetBoundary);

      expect(repBoundaries).toHaveLength(6);
      expect(setBoundaries).toHaveLength(3);
    });

    it('session config overrides base config repsPerSet', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        repsPerSet: 10, // base config says 10
        sessionConfig: {
          sets: 1,
          repsPerSet: 2, // session says 2
          restBetweenSetsMs: 100,
          interSetRecovery: 0.5,
        },
      });
      const notifications = collectNotifications(adapter);
      await connectAdapter(adapter);

      tickSamples(SAMPLES_PER_REP * 2);
      await adapter.disconnect();

      const setBoundaries = notifications.filter(isSetBoundary);
      expect(setBoundaries).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Session stops after configured sets
  // ===========================================================================

  describe('session termination', () => {
    it('stops telemetry after all sets complete', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        sessionConfig: {
          sets: 2,
          repsPerSet: 2,
          restBetweenSetsMs: 100,
          interSetRecovery: 0.5,
        },
      });
      const notifications = collectNotifications(adapter);
      await connectAdapter(adapter);

      // Set 1
      tickSamples(SAMPLES_PER_REP * 2);
      vi.advanceTimersByTime(100);
      // Set 2
      tickSamples(SAMPLES_PER_REP * 2);

      const countAfterCompletion = notifications.length;

      // More ticks should produce no new notifications (telemetry stopped)
      tickSamples(SAMPLES_PER_REP * 2);

      expect(notifications.length).toBe(countAfterCompletion);

      const setBoundaries = notifications.filter(isSetBoundary);
      expect(setBoundaries).toHaveLength(2);

      await adapter.disconnect();
    });
  });

  // ===========================================================================
  // Inter-set fatigue recovery
  // ===========================================================================

  describe('inter-set recovery', () => {
    it('reduces fatigue between sets', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        sessionConfig: {
          sets: 2,
          repsPerSet: 3,
          restBetweenSetsMs: 100,
          interSetRecovery: 0.8,
        },
      });
      const notifications = collectNotifications(adapter);
      await connectAdapter(adapter);

      // Set 1: 3 reps
      tickSamples(SAMPLES_PER_REP * 3);

      // Collect peak concentric velocity from last rep of set 1
      const framesSet1 = notifications
        .filter(isTelemetryFrame)
        .map((d) => decodeTelemetryFrame(d)!);
      const concSet1 = framesSet1.filter((f) => f.phase === MovementPhase.CONCENTRIC);
      // Last rep's concentric frames (last 9 concentric samples)
      const lastRepConc = concSet1.slice(-9);
      const peakVelSet1 = Math.max(...lastRepConc.map((f) => Math.abs(f.velocity)));

      // Rest
      vi.advanceTimersByTime(100);

      // Set 2: first rep — fatigue should be reduced (recovered)
      const preSet2Count = notifications.length;
      tickSamples(SAMPLES_PER_REP);

      const framesSet2 = notifications
        .slice(preSet2Count)
        .filter(isTelemetryFrame)
        .map((d) => decodeTelemetryFrame(d)!);
      const concSet2 = framesSet2.filter((f) => f.phase === MovementPhase.CONCENTRIC);
      const peakVelSet2 = Math.max(...concSet2.map((f) => Math.abs(f.velocity)));

      // After 80% recovery, first rep of set 2 should have higher peak velocity
      // than last rep of set 1 (which had accumulated fatigue from 3 reps)
      expect(peakVelSet2).toBeGreaterThan(peakVelSet1);

      await adapter.disconnect();
    });
  });

  // ===========================================================================
  // Pause sets
  // ===========================================================================

  describe('pause sets', () => {
    it('produces idle frames between clusters within a pause set', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        sessionConfig: {
          sets: 2,
          repsPerSet: 5,
          restBetweenSetsMs: 100,
          interSetRecovery: 0.5,
          pauseSet: {
            setIndex: 0,
            pauseAfterReps: [2],
            pauseDurationMs: 200,
          },
        },
      });
      const notifications = collectNotifications(adapter);
      await connectAdapter(adapter);

      // First cluster: 2 reps
      tickSamples(SAMPLES_PER_REP * 2);

      // At this point, pause should be triggered
      const countBeforePause = notifications.length;

      // Advance through the pause — should get idle frames
      vi.advanceTimersByTime(200);

      const pauseNotifications = notifications.slice(countBeforePause);
      const idleFrames = pauseNotifications.filter(isTelemetryFrame).filter((d) => {
        const f = decodeTelemetryFrame(d);
        return f && f.phase === MovementPhase.IDLE;
      });

      expect(idleFrames.length).toBeGreaterThan(0);

      // No set boundary during pause
      const setBoundaries = pauseNotifications.filter(isSetBoundary);
      expect(setBoundaries).toHaveLength(0);

      await adapter.disconnect();
    });

    it('resumes normal reps after pause and completes the set', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        sessionConfig: {
          sets: 1,
          repsPerSet: 4,
          restBetweenSetsMs: 100,
          interSetRecovery: 0.5,
          pauseSet: {
            setIndex: 0,
            pauseAfterReps: [2],
            pauseDurationMs: 200,
          },
        },
      });
      const notifications = collectNotifications(adapter);
      await connectAdapter(adapter);

      // First cluster: 2 reps
      tickSamples(SAMPLES_PER_REP * 2);
      // Pause
      vi.advanceTimersByTime(200);
      // Remaining reps: 2 more to complete the set
      tickSamples(SAMPLES_PER_REP * 2);

      await adapter.disconnect();

      const repBoundaries = notifications.filter(isRepBoundary);
      const setBoundaries = notifications.filter(isSetBoundary);

      expect(repBoundaries).toHaveLength(4);
      expect(setBoundaries).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Tempo overrides
  // ===========================================================================

  describe('tempo overrides', () => {
    it('changes phase durations with tempo config', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        sessionConfig: {
          sets: 1,
          repsPerSet: 1,
          restBetweenSetsMs: 100,
          interSetRecovery: 0.5,
          tempo: {
            concentricCount: 20,
            holdCount: 10,
            eccentricCount: 30,
            idleCount: 5,
          },
        },
      });
      const notifications = collectNotifications(adapter);
      await connectAdapter(adapter);

      // Custom rep cycle: 5 + 20 + 10 + 30 = 65 samples
      const customSamplesPerRep = 5 + 20 + 10 + 30;
      tickSamples(customSamplesPerRep);

      await adapter.disconnect();

      const frames = notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);

      const concentricFrames = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);
      const holdFrames = frames.filter((f) => f.phase === MovementPhase.HOLD);
      const eccentricFrames = frames.filter((f) => f.phase === MovementPhase.ECCENTRIC);

      expect(concentricFrames).toHaveLength(20);
      expect(holdFrames).toHaveLength(10);
      expect(eccentricFrames).toHaveLength(30);

      const repBoundaries = notifications.filter(isRepBoundary);
      expect(repBoundaries).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Preset scenarios
  // ===========================================================================

  describe('preset scenarios', () => {
    it('createMultiSetScenario returns valid config', () => {
      const config = createMultiSetScenario();
      expect(config.sets).toBe(3);
      expect(config.repsPerSet).toBe(8);
      expect(config.interSetRecovery).toBe(0.6);
    });

    it('createPauseSetScenario returns config with pause set', () => {
      const config = createPauseSetScenario();
      expect(config.pauseSet).toBeDefined();
      expect(config.pauseSet!.setIndex).toBe(1);
      expect(config.pauseSet!.pauseAfterReps).toEqual([5, 3]);
    });

    it('createTempoScenario returns config with tempo overrides', () => {
      const config = createTempoScenario();
      expect(config.tempo).toBeDefined();
      expect(config.tempo!.concentricCount).toBe(33);
    });

    it('createShortRestScenario returns valid config', () => {
      const config = createShortRestScenario();
      expect(config.sets).toBe(2);
      expect(config.restBetweenSetsMs).toBe(12000);
    });
  });
});
