/**
 * Mock adapter types and configuration defaults.
 */

import { MovementPhase, TrainingMode } from '../../../voltra/protocol/constants/enums';

export interface DeviceParameterConfig {
  serialNumber?: string;
  firmwareVersion?: string;
  hardwareVersion?: string;
  modelName?: string;
  /** Initial battery level (0–100). Drains ~1% per minute during active motor engagement. */
  batteryLevel?: number;
  /** Base RSSI in dBm. Returned with gaussian noise (±5 dBm std dev). */
  rssi?: number;
}

export interface ResolvedDeviceParams {
  serialNumber: string;
  firmwareVersion: string;
  hardwareVersion: string;
  modelName: string;
  batteryLevel: number;
  rssi: number;
}

export const DEVICE_PARAM_DEFAULTS: ResolvedDeviceParams = {
  serialNumber: 'VLT-000000',
  firmwareVersion: '1.0.0',
  hardwareVersion: '1.0',
  modelName: 'Voltra',
  batteryLevel: 100,
  rssi: -60,
} as const;

/** Battery drain rate: ~1% per minute = 1/60000 per ms */
export const BATTERY_DRAIN_PER_MS = 1 / 60_000;

/** Standard deviation for RSSI gaussian noise in dBm */
export const RSSI_NOISE_STD_DEV = 5;

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
  /** Configurable device identity and simulation parameters */
  device?: DeviceParameterConfig;
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
