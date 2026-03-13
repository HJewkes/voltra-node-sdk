/**
 * MockBLEAdapter Rep Plan Tests
 *
 * Verifies deterministic rep plan telemetry generation: phase sequences,
 * linear position interpolation, velocity values, plan exhaustion, and
 * clearing behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockBLEAdapter } from '../mock';
import type { PlannedRepProfile } from '../mock/types';
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

const SAMPLE_INTERVAL_MS = 91;

function collectNotifications(adapter: MockBLEAdapter): Uint8Array[] {
  const notifications: Uint8Array[] = [];
  adapter.onNotification((data) => notifications.push(data));
  return notifications;
}

function isTelemetryFrame(data: Uint8Array): boolean {
  return data.length === 30 && bytesEqual(data.subarray(0, 4), MessageTypes.TELEMETRY_STREAM);
}

function decodeTelemetry(notifications: Uint8Array[]) {
  return notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
}

async function connectAdapter(adapter: MockBLEAdapter): Promise<void> {
  const p = adapter.connect('x');
  vi.advanceTimersByTime(0);
  await p;
}

function tickSamples(n: number): void {
  for (let i = 0; i < n; i++) {
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS);
  }
}

function makeSimpleRep(overrides?: Partial<PlannedRepProfile>): PlannedRepProfile {
  return {
    conSeconds: 1,
    holdSeconds: 0.5,
    eccSeconds: 1,
    idleSeconds: 1,
    romMm: 500,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('MockBLEAdapter rep plan', () => {
  it('produces correct phase sequence for a single rep (CON->HOLD->ECC->IDLE)', async () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const rep = makeSimpleRep();
    adapter.setRepPlan([rep]);

    const notifications = collectNotifications(adapter);
    await connectAdapter(adapter);

    const totalSeconds = rep.conSeconds + rep.holdSeconds + rep.eccSeconds + rep.idleSeconds;
    const totalSamples = Math.ceil(totalSeconds / (SAMPLE_INTERVAL_MS / 1000));
    tickSamples(totalSamples);

    await adapter.disconnect();

    const frames = decodeTelemetry(notifications);
    const phases = frames.map((f) => f.phase);

    // Should see CON first, then HOLD, then ECC, then IDLE — in order
    const firstConIdx = phases.indexOf(MovementPhase.CONCENTRIC);
    const firstHoldIdx = phases.indexOf(MovementPhase.HOLD);
    const firstEccIdx = phases.indexOf(MovementPhase.ECCENTRIC);
    const lastIdx = phases.lastIndexOf(MovementPhase.IDLE);

    expect(firstConIdx).toBeGreaterThanOrEqual(0);
    expect(firstHoldIdx).toBeGreaterThan(firstConIdx);
    expect(firstEccIdx).toBeGreaterThan(firstHoldIdx);
    expect(lastIdx).toBeGreaterThan(firstEccIdx);
  });

  it('linearly interpolates position during concentric (0 -> romMm)', async () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const rep = makeSimpleRep({ conSeconds: 1, romMm: 1000 });
    adapter.setRepPlan([rep]);

    const notifications = collectNotifications(adapter);
    await connectAdapter(adapter);

    // Tick through the concentric phase (1 second = ~11 samples)
    tickSamples(11);

    await adapter.disconnect();

    const frames = decodeTelemetry(notifications);
    const conFrames = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);

    expect(conFrames.length).toBeGreaterThan(0);

    // Position should increase monotonically
    for (let i = 1; i < conFrames.length; i++) {
      expect(conFrames[i].position).toBeGreaterThanOrEqual(conFrames[i - 1].position);
    }

    // First should be near 0, last should approach romMm
    expect(conFrames[0].position).toBeLessThan(200);
    expect(conFrames[conFrames.length - 1].position).toBeGreaterThan(700);
  });

  it('linearly interpolates position during eccentric (romMm -> 0)', async () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const rep = makeSimpleRep({ conSeconds: 0.5, holdSeconds: 0.2, eccSeconds: 1, romMm: 1000 });
    adapter.setRepPlan([rep]);

    const notifications = collectNotifications(adapter);
    await connectAdapter(adapter);

    // Tick through CON + HOLD + ECC (~1.7s total, ~19 samples)
    tickSamples(20);

    await adapter.disconnect();

    const frames = decodeTelemetry(notifications);
    const eccFrames = frames.filter((f) => f.phase === MovementPhase.ECCENTRIC);

    expect(eccFrames.length).toBeGreaterThan(0);

    // Position should decrease monotonically
    for (let i = 1; i < eccFrames.length; i++) {
      expect(eccFrames[i].position).toBeLessThanOrEqual(eccFrames[i - 1].position);
    }

    // First should be near romMm, last should approach 0
    expect(eccFrames[0].position).toBeGreaterThan(700);
    expect(eccFrames[eccFrames.length - 1].position).toBeLessThan(300);
  });

  it('velocity during concentric approximates romMm / conSeconds', async () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const rep = makeSimpleRep({ conSeconds: 2, romMm: 600 });
    adapter.setRepPlan([rep]);

    const notifications = collectNotifications(adapter);
    await connectAdapter(adapter);

    tickSamples(15);

    await adapter.disconnect();

    const frames = decodeTelemetry(notifications);
    const conFrames = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);
    const expectedVelocity = 600 / 2; // 300 mm/s

    expect(conFrames.length).toBeGreaterThan(0);
    for (const f of conFrames) {
      expect(f.velocity).toBeCloseTo(expectedVelocity, -1);
    }
  });

  it('stays in IDLE after all reps are consumed', async () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const rep = makeSimpleRep({ conSeconds: 0.3, holdSeconds: 0.1, eccSeconds: 0.3, idleSeconds: 0.3 });
    adapter.setRepPlan([rep]);

    const notifications = collectNotifications(adapter);
    await connectAdapter(adapter);

    // Tick past the entire rep (1s) plus extra time
    tickSamples(30);

    await adapter.disconnect();

    const frames = decodeTelemetry(notifications);

    // Last several frames should all be IDLE
    const tailFrames = frames.slice(-5);
    for (const f of tailFrames) {
      expect(f.phase).toBe(MovementPhase.IDLE);
      expect(f.position).toBeCloseTo(0, 0);
    }
  });

  it('produces correct sequence for multiple reps', async () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const reps = [
      makeSimpleRep({ conSeconds: 0.5, holdSeconds: 0.2, eccSeconds: 0.5, idleSeconds: 0.3, romMm: 400 }),
      makeSimpleRep({ conSeconds: 0.5, holdSeconds: 0.2, eccSeconds: 0.5, idleSeconds: 0.3, romMm: 400 }),
    ];
    adapter.setRepPlan(reps);

    const notifications = collectNotifications(adapter);
    await connectAdapter(adapter);

    // Each rep is 1.5s, so 3s total = ~33 samples; tick a few extra
    tickSamples(40);

    await adapter.disconnect();

    const frames = decodeTelemetry(notifications);
    const phases = frames.map((f) => f.phase);

    // Count concentric runs — should see two separate groups
    let conRunCount = 0;
    let inCon = false;
    for (const p of phases) {
      if (p === MovementPhase.CONCENTRIC && !inCon) {
        conRunCount++;
        inCon = true;
      } else if (p !== MovementPhase.CONCENTRIC) {
        inCon = false;
      }
    }

    expect(conRunCount).toBe(2);
  });

  it('clearRepPlan reverts to normal fatigue-based behavior', async () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    adapter.setRepPlan([makeSimpleRep()]);
    adapter.clearRepPlan();

    const notifications = collectNotifications(adapter);
    await connectAdapter(adapter);

    // Standard rep cycle: IDLE(5) + CON(9) + HOLD(2) + ECC(16) = 32
    tickSamples(32);

    await adapter.disconnect();

    const frames = decodeTelemetry(notifications);

    // Should see the normal phase cycling (starts with IDLE phase from profile)
    const phases = frames.map((f) => f.phase);
    const hasConPhase = phases.includes(MovementPhase.CONCENTRIC);
    const hasEccPhase = phases.includes(MovementPhase.ECCENTRIC);

    expect(hasConPhase).toBe(true);
    expect(hasEccPhase).toBe(true);

    // Verify it produced normal frames, not rep-plan frames.
    // Normal cycling has different velocity patterns (not constant during CON).
    const conFrames = frames.filter((f) => f.phase === MovementPhase.CONCENTRIC);
    if (conFrames.length > 2) {
      const velocities = conFrames.map((f) => f.velocity);
      const allSame = velocities.every((v) => Math.abs(v - velocities[0]) < 0.01);
      // Normal cycling should NOT have constant velocity (it uses sin curves)
      expect(allSame).toBe(false);
    }
  });

  it('rep plan can be set while telemetry is already streaming', async () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });

    const notifications = collectNotifications(adapter);
    await connectAdapter(adapter);

    // Let normal telemetry run for a bit
    tickSamples(10);
    const preCount = notifications.length;

    // Now set a rep plan mid-stream
    adapter.setRepPlan([
      makeSimpleRep({ conSeconds: 0.5, holdSeconds: 0.2, eccSeconds: 0.5, idleSeconds: 0.3, romMm: 800 }),
    ]);

    // Tick through the rep plan
    tickSamples(20);

    await adapter.disconnect();

    const postFrames = decodeTelemetry(notifications.slice(preCount));

    // Should see concentric frames from the rep plan with expected velocity
    const conFrames = postFrames.filter((f) => f.phase === MovementPhase.CONCENTRIC);
    expect(conFrames.length).toBeGreaterThan(0);

    const expectedVelocity = 800 / 0.5; // 1600 mm/s
    for (const f of conFrames) {
      expect(f.velocity).toBeCloseTo(expectedVelocity, -1);
    }
  });
});
