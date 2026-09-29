/**
 * Mock kinematics unit tests
 *
 * Checks the mock's decoded telemetry against an independent reference: the
 * decoder's documented units (position in mm, velocity in mm/s) and plausible
 * hardware ranges written below. Nothing here reads the mock's own constants,
 * so a mock that drifts out of real-hardware units fails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockBLEAdapter } from '../mock';
import { decodeTelemetryFrame } from '../../../voltra/protocol/telemetry-decoder';
import { MessageTypes } from '../../../voltra/protocol/constants/message-types';
import { MovementPhase, TrainingMode } from '../../../voltra/protocol/constants/enums';
import type { TelemetryFrame } from '../../../voltra/models/telemetry/frame';
import { bytesEqual } from '../../../shared/utils';

/** Hardware full pulls run roughly 850 to 1300 mm, depending on setup. */
const REAL_FULL_PULL_MIN_MM = 850;
const REAL_FULL_PULL_MAX_MM = 1300;

/** Plausible peak concentric cable speed on hardware, 0.3 to 1.5 m/s, in mm/s. */
const REAL_PEAK_VELOCITY_MIN_MM_S = 300;
const REAL_PEAK_VELOCITY_MAX_MM_S = 1500;

const SAMPLE_INTERVAL_MS = 91;
/** Long enough to cover at least one full rep in every mode. */
const SAMPLES_TO_COLLECT = 60;

const MOVING_MODES = [
  { name: 'weight training', mode: TrainingMode.WeightTraining },
  { name: 'resistance band', mode: TrainingMode.ResistanceBand },
  { name: 'rowing', mode: TrainingMode.Rowing },
  { name: 'damper', mode: TrainingMode.Damper },
  { name: 'custom curves', mode: TrainingMode.CustomCurves },
  { name: 'isokinetic', mode: TrainingMode.Isokinetic },
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function isTelemetryFrame(data: Uint8Array): boolean {
  return bytesEqual(data.subarray(0, 4), MessageTypes.TELEMETRY_STREAM);
}

async function collectFrames(trainingMode: TrainingMode): Promise<TelemetryFrame[]> {
  const adapter = new MockBLEAdapter({ connectDelayMs: 0, trainingMode });
  const notifications: Uint8Array[] = [];
  adapter.onNotification((data) => notifications.push(data));

  const connecting = adapter.connect('x');
  vi.advanceTimersByTime(0);
  await connecting;
  for (let i = 0; i < SAMPLES_TO_COLLECT; i++) {
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS);
  }
  await adapter.disconnect();

  return notifications.filter(isTelemetryFrame).map((d) => decodeTelemetryFrame(d)!);
}

function peakConcentricVelocity(frames: TelemetryFrame[]): number {
  return Math.max(
    ...frames.filter((f) => f.phase === MovementPhase.CONCENTRIC).map((f) => Math.abs(f.velocity))
  );
}

/** First contiguous concentric stretch, i.e. the first rep's pull. */
function firstConcentricRun(frames: TelemetryFrame[]): TelemetryFrame[] {
  const start = frames.findIndex((f) => f.phase === MovementPhase.CONCENTRIC);
  const run: TelemetryFrame[] = [];
  for (let i = start; i >= 0 && i < frames.length; i++) {
    if (frames[i].phase !== MovementPhase.CONCENTRIC) break;
    run.push(frames[i]);
  }
  return run;
}

/** How far the ramp-implied and field-implied mean speeds may differ. */
const RAMP_VELOCITY_TOLERANCE = 0.2;

describe('mock kinematics units', () => {
  it.each(MOVING_MODES)(
    '$name position ramp and velocity field imply the same mean concentric speed',
    async ({ mode }) => {
      const frames = await collectFrames(mode);
      const run = firstConcentricRun(frames);

      const rom = Math.max(...frames.map((f) => f.position));
      const rampMeanSpeed = rom / ((run.length * SAMPLE_INTERVAL_MS) / 1000);
      const fieldMeanSpeed = run.reduce((sum, f) => sum + Math.abs(f.velocity), 0) / run.length;

      expect(Math.abs(rampMeanSpeed / fieldMeanSpeed - 1)).toBeLessThanOrEqual(
        RAMP_VELOCITY_TOLERANCE
      );
    }
  );

  it.each(MOVING_MODES)(
    '$name reaches a full pull inside the hardware mm range',
    async ({ mode }) => {
      const frames = await collectFrames(mode);

      const peakPosition = Math.max(...frames.map((f) => f.position));

      expect(peakPosition).toBeGreaterThanOrEqual(REAL_FULL_PULL_MIN_MM);
      expect(peakPosition).toBeLessThanOrEqual(REAL_FULL_PULL_MAX_MM);
    }
  );

  it.each(MOVING_MODES)(
    '$name peaks concentric velocity inside the hardware mm/s range',
    async ({ mode }) => {
      const frames = await collectFrames(mode);

      const peakVelocity = peakConcentricVelocity(frames);

      expect(peakVelocity).toBeGreaterThanOrEqual(REAL_PEAK_VELOCITY_MIN_MM_S);
      expect(peakVelocity).toBeLessThanOrEqual(REAL_PEAK_VELOCITY_MAX_MM_S);
    }
  );

  it('isometric mode never moves the cable', async () => {
    const frames = await collectFrames(TrainingMode.Isometric);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => f.position === 0 && f.velocity === 0)).toBe(true);
  });
});
