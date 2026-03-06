/**
 * Mock adapter types and configuration defaults.
 */

import { MovementPhase, TrainingMode } from '../../../voltra/protocol/constants/enums';

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

// =============================================================================
// Error Injection Types
// =============================================================================

export type ErrorScenarioType =
  | 'disconnect'
  | 'authTimeout'
  | 'notificationDrop'
  | 'malformedFrame'
  | 'reconnectCycle';

export interface DisconnectConfig {
  afterMs: number;
}

export interface AuthTimeoutConfig {
  timeoutMs?: number;
}

export interface NotificationDropConfig {
  dropRate: number;
}

export interface MalformedFrameConfig {
  corruptionRate: number;
}

export interface ReconnectCycleConfig {
  disconnectAfterMs: number;
  reconnectDelayMs: number;
}

export type ErrorConfig =
  | DisconnectConfig
  | AuthTimeoutConfig
  | NotificationDropConfig
  | MalformedFrameConfig
  | ReconnectCycleConfig;

export interface ErrorScenarioEntry {
  type: ErrorScenarioType;
  config: ErrorConfig;
}

export interface MockBLEErrorConfig {
  errorScenario?: ErrorScenarioType;
  errorConfig?: ErrorConfig;
}
