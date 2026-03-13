/**
 * Mock adapter types and configuration defaults.
 */

import { MovementPhase, TrainingMode } from '../../../voltra/protocol/constants/enums';

export interface MockSessionConfig {
  /** Number of sets to simulate */
  sets: number;
  /** Reps per set (overrides MockBLEConfig.repsPerSet) */
  repsPerSet: number;
  /** Rest between sets in ms (overrides MockBLEConfig.restBetweenSetsMs) */
  restBetweenSetsMs: number;

  /** Pause set config — one set gets intra-set pauses */
  pauseSet?: {
    /** Which set index (0-based) has pauses */
    setIndex: number;
    /** Pause after these rep counts, e.g. [5, 3] = pause after rep 5, then 3 more */
    pauseAfterReps: number[];
    /** Duration of each intra-set pause in ms */
    pauseDurationMs: number;
  };

  /** Per-phase sample count overrides (overrides profile defaults) */
  tempo?: {
    concentricCount?: number;
    holdCount?: number;
    eccentricCount?: number;
    idleCount?: number;
  };

  /** How much fatigue recovers between sets (0.0-1.0) */
  interSetRecovery: number;
}

export interface MockBLEConfig {
  deviceName?: string;
  deviceId?: string;
  scanDelayMs?: number;
  connectDelayMs?: number;
  /** Weight in lbs — affects force values */
  weight?: number;
  repsPerSet?: number;
  restBetweenSetsMs?: number;
  /** Training mode — defaults to WeightTraining for backwards compatibility */
  trainingMode?: TrainingMode;
  /** Session-level config for multi-set simulation */
  sessionConfig?: MockSessionConfig;
}

export const MOCK_DEFAULTS = {
  deviceName: 'VTR-Mock',
  deviceId: 'mock-voltra-001',
  scanDelayMs: 200,
  connectDelayMs: 300,
  weight: 100,
  repsPerSet: 5,
  restBetweenSetsMs: 3000,
  trainingMode: TrainingMode.WeightTraining,
} as const;

export const SAMPLE_INTERVAL_MS = 91; // ~11Hz
export const FATIGUE_RATE = 0.03;

/** A single rep profile for deterministic mock telemetry generation */
export interface PlannedRepProfile {
  /** Concentric phase duration in seconds */
  conSeconds: number;
  /** Hold/top phase duration in seconds */
  holdSeconds: number;
  /** Eccentric phase duration in seconds */
  eccSeconds: number;
  /** Idle time after this rep in seconds (>7s will trigger rest detection in session store) */
  idleSeconds: number;
  /** Range of motion in mm */
  romMm: number;
}

export interface KinematicsValues {
  position: number;
  velocity: number;
  force: number;
}

export interface PhaseDef {
  phase: MovementPhase;
  count: number;
}

export type ForceCurve = (progress: number, baseForce: number, fatigue: number) => number;

export interface ModeConstants {
  concentricVelocityPeak: number;
  eccentricVelocityPeak: number;
  holdForceMultiplier: number;
  concentricForce: ForceCurve;
  eccentricForce: ForceCurve;
}

export interface KinematicsProfile {
  phases: PhaseDef[];
  maxPosition: number;
  buildValues(
    phase: MovementPhase,
    progress: number,
    fatigue: number,
    baseForce: number,
    maxPosition: number
  ): KinematicsValues;
}
