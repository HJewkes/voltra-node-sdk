/**
 * Preset session scenario factories for MockBLEAdapter.
 *
 * Each factory returns a MockSessionConfig that orchestrates multi-set
 * simulation with specific characteristics (pause sets, tempo overrides, etc.).
 */

import type { MockSessionConfig } from './types';

/** 3 sets x 8 reps, 90s rest, 60% fatigue recovery */
export function createMultiSetScenario(): MockSessionConfig {
  return {
    sets: 3,
    repsPerSet: 8,
    restBetweenSetsMs: 5000,
    interSetRecovery: 0.6,
  };
}

/** Set 1 has pauses after reps 5 and 3 more (10s each) */
export function createPauseSetScenario(): MockSessionConfig {
  return {
    sets: 3,
    repsPerSet: 10,
    restBetweenSetsMs: 5000,
    interSetRecovery: 0.6,
    pauseSet: {
      setIndex: 1,
      pauseAfterReps: [5, 3],
      pauseDurationMs: 10000,
    },
  };
}

/** 3s concentric target for tempo pacing testing */
export function createTempoScenario(): MockSessionConfig {
  return {
    sets: 3,
    repsPerSet: 6,
    restBetweenSetsMs: 5000,
    interSetRecovery: 0.7,
    tempo: {
      concentricCount: 33,
      holdCount: 6,
      eccentricCount: 44,
      idleCount: 6,
    },
  };
}

/** Short rest resume — rest triggers but lifting resumes at ~12s */
export function createShortRestScenario(): MockSessionConfig {
  return {
    sets: 2,
    repsPerSet: 5,
    restBetweenSetsMs: 12000,
    interSetRecovery: 0.8,
  };
}
