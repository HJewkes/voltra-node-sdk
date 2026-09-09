/**
 * Mock kinematics unit tests
 *
 * Confirms the mock's simulated velocity is scaled into the same unit the
 * real device's telemetry frame uses (mm/s, per telemetry-decoder.ts), not
 * left in the ModeConstants' native cm/s.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockBLEAdapter } from '../mock';
import { WEIGHT_TRAINING_CONSTANTS } from '../mock/profiles';
import { VELOCITY_UNIT_FACTOR } from '../mock/kinematics';
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

const SAMPLE_INTERVAL_MS = 91;
const IDLE_SAMPLES = 5;
const CONCENTRIC_SAMPLES = 9;

function isTelemetryFrame(data: Uint8Array): boolean {
  return data.length === 30 && bytesEqual(data.subarray(0, 4), MessageTypes.TELEMETRY_STREAM);
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

describe('mock kinematics velocity units', () => {
  it('scales a working rep peak concentric velocity to the decoder-documented mm/s band', async () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const notifications: Uint8Array[] = [];
    adapter.onNotification((data) => notifications.push(data));

    await connectAdapter(adapter);
    // Run past the initial IDLE phase into the first rep's CONCENTRIC phase.
    tickSamples(IDLE_SAMPLES + CONCENTRIC_SAMPLES);
    await adapter.disconnect();

    const conFrames = notifications
      .filter(isTelemetryFrame)
      .map((d) => decodeTelemetryFrame(d)!)
      .filter((f) => f.phase === MovementPhase.CONCENTRIC);

    expect(conFrames.length).toBeGreaterThan(0);
    const peakVelocity = Math.max(...conFrames.map((f) => f.velocity));

    // Derived from the real WeightTraining ModeConstants and the same
    // cm-to-mm factor kinematics.ts applies — not a new magic number.
    const expectedPeak = WEIGHT_TRAINING_CONSTANTS.concentricVelocityPeak * VELOCITY_UNIT_FACTOR;

    // sin(progress*pi) <= 1 and fatigue <= 1 for the first rep, so the
    // scaled peak can only sit at or below expectedPeak; the discrete
    // sample grid gets within ~2% of the true sine peak.
    expect(peakVelocity).toBeLessThanOrEqual(expectedPeak);
    expect(peakVelocity).toBeGreaterThan(expectedPeak * 0.9);
  });
});
