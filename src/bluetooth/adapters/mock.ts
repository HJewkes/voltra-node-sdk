/**
 * MockBLEAdapter
 *
 * Simulates a connected Voltra device with realistic telemetry streaming.
 * Used for visual development and Playwright testing where Web Bluetooth
 * is unavailable (automated Chrome can't show the system device picker).
 *
 * On connect, emits encoded 30-byte telemetry frames at 11Hz following
 * real device phase transitions: IDLE -> CONCENTRIC -> HOLD -> ECCENTRIC -> IDLE.
 * Also emits rep/set boundary notifications.
 */

import { BaseBLEAdapter } from './base';
import type { Device, ConnectOptions } from './types';
import { MovementPhase, TrainingMode, VALID_TRAINING_MODES } from '../../voltra/protocol/constants/enums';
import { MessageTypes, NotificationConfigs } from '../../voltra/protocol/constants/message-types';
import { createFrame } from '../../voltra/models/telemetry/frame';
import { encodeTelemetryFrame } from '../../voltra/protocol/telemetry-decoder';
import { getModeCommand } from '../../voltra/protocol/commands';
import { bytesEqual, hexToBytes } from '../../shared/utils';

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

const DEFAULTS = {
  deviceName: 'VTR-Mock',
  deviceId: 'mock-voltra-001',
  scanDelayMs: 200,
  connectDelayMs: 300,
  weight: 100,
  repsPerSet: 5,
  restBetweenSetsMs: 3000,
  trainingMode: TrainingMode.WeightTraining,
} as const;

const SAMPLE_INTERVAL_MS = 91; // ~11Hz
const FATIGUE_RATE = 0.03;

// =============================================================================
// Kinematics Profiles
// =============================================================================

interface KinematicsValues {
  position: number;
  velocity: number;
  force: number;
}

interface PhaseDef {
  phase: MovementPhase;
  count: number;
}

type ForceCurve = (progress: number, baseForce: number, fatigue: number) => number;

interface ModeConstants {
  concentricVelocityPeak: number;
  eccentricVelocityPeak: number;
  holdForceMultiplier: number;
  concentricForce: ForceCurve;
  eccentricForce: ForceCurve;
}

interface KinematicsProfile {
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

function buildStandardValues(
  constants: ModeConstants,
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  maxPosition: number
): KinematicsValues {
  switch (phase) {
    case MovementPhase.CONCENTRIC:
      return {
        position: Math.round(progress * maxPosition),
        velocity: Math.round(Math.sin(progress * Math.PI) * constants.concentricVelocityPeak * fatigue),
        force: Math.round(constants.concentricForce(progress, baseForce, fatigue)),
      };
    case MovementPhase.HOLD:
      return {
        position: maxPosition,
        velocity: 0,
        force: Math.round(baseForce * constants.holdForceMultiplier),
      };
    case MovementPhase.ECCENTRIC:
      return {
        position: Math.round((1 - progress) * maxPosition),
        velocity: Math.round(Math.sin(progress * Math.PI) * constants.eccentricVelocityPeak * fatigue),
        force: Math.round(constants.eccentricForce(progress, baseForce, fatigue)),
      };
    default:
      return { position: 0, velocity: 0, force: 0 };
  }
}

function standardProfile(
  phases: PhaseDef[],
  maxPosition: number,
  constants: ModeConstants
): KinematicsProfile {
  return {
    phases,
    maxPosition,
    buildValues: (phase, progress, fatigue, baseForce, maxPos) =>
      buildStandardValues(constants, phase, progress, fatigue, baseForce, maxPos),
  };
}

// Damper: force depends on computed velocity, not a standard force curve
function damperBuildValues(
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  maxPosition: number
): KinematicsValues {
  switch (phase) {
    case MovementPhase.CONCENTRIC: {
      const velocity = Math.round(Math.sin(progress * Math.PI) * 75 * fatigue);
      return {
        position: Math.round(progress * maxPosition),
        velocity,
        force: Math.round(velocity * baseForce * 0.02 * fatigue),
      };
    }
    case MovementPhase.HOLD:
      return { position: maxPosition, velocity: 0, force: Math.round(baseForce * 0.1) };
    case MovementPhase.ECCENTRIC: {
      const velocity = Math.round(Math.sin(progress * Math.PI) * 38 * fatigue);
      return {
        position: Math.round((1 - progress) * maxPosition),
        velocity,
        force: Math.round(velocity * baseForce * 0.015 * fatigue),
      };
    }
    default:
      return { position: 0, velocity: 0, force: 0 };
  }
}

// Isokinetic: constant velocity, variable force
function isokineticBuildValues(
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  maxPosition: number
): KinematicsValues {
  const constantVelocity = 45;
  switch (phase) {
    case MovementPhase.CONCENTRIC:
      return {
        position: Math.round(progress * maxPosition),
        velocity: constantVelocity,
        force: Math.round(baseForce * (0.8 + Math.sin(progress * Math.PI) * 0.4) * fatigue),
      };
    case MovementPhase.HOLD:
      return { position: maxPosition, velocity: 0, force: Math.round(baseForce * 0.6) };
    case MovementPhase.ECCENTRIC:
      return {
        position: Math.round((1 - progress) * maxPosition),
        velocity: constantVelocity,
        force: Math.round(baseForce * (0.6 + Math.sin(progress * Math.PI) * 0.3) * fatigue),
      };
    default:
      return { position: 0, velocity: 0, force: 0 };
  }
}

// Isometric: no movement, pure force output
function isometricBuildValues(
  _phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number
): KinematicsValues {
  return {
    position: 0,
    velocity: 0,
    force: Math.round(baseForce * (0.7 + Math.sin(progress * Math.PI * 2) * 0.3) * fatigue),
  };
}

const STANDARD_PHASES: PhaseDef[] = [
  { phase: MovementPhase.IDLE, count: 5 },
  { phase: MovementPhase.CONCENTRIC, count: 9 },
  { phase: MovementPhase.HOLD, count: 2 },
  { phase: MovementPhase.ECCENTRIC, count: 16 },
];

const WEIGHT_TRAINING_PROFILE = standardProfile(STANDARD_PHASES, 600, {
  concentricVelocityPeak: 80,
  eccentricVelocityPeak: 40,
  holdForceMultiplier: 0.5,
  concentricForce: (p, bf, f) => bf * (1 - p * 0.3) * f,
  eccentricForce: (p, bf, f) => bf * 0.8 * (1 - p * 0.2) * f,
});

const KINEMATICS_PROFILES: Record<TrainingMode, KinematicsProfile> = {
  [TrainingMode.Idle]: WEIGHT_TRAINING_PROFILE,
  [TrainingMode.WeightTraining]: WEIGHT_TRAINING_PROFILE,

  [TrainingMode.ResistanceBand]: standardProfile(
    [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 10 },
      { phase: MovementPhase.HOLD, count: 3 },
      { phase: MovementPhase.ECCENTRIC, count: 14 },
    ],
    650,
    {
      concentricVelocityPeak: 70,
      eccentricVelocityPeak: 35,
      holdForceMultiplier: 0.9,
      concentricForce: (p, bf, f) => bf * (0.4 + p * 0.6) * f,
      eccentricForce: (p, bf, f) => bf * (1.0 - p * 0.6) * f,
    }
  ),

  [TrainingMode.Rowing]: standardProfile(
    [
      { phase: MovementPhase.IDLE, count: 6 },
      { phase: MovementPhase.CONCENTRIC, count: 14 },
      { phase: MovementPhase.HOLD, count: 2 },
      { phase: MovementPhase.ECCENTRIC, count: 20 },
    ],
    700,
    {
      concentricVelocityPeak: 50,
      eccentricVelocityPeak: 25,
      holdForceMultiplier: 0.3,
      concentricForce: (p, bf, f) => bf * Math.exp(-p * 0.5) * f,
      eccentricForce: (_p, bf, f) => bf * 0.4 * f,
    }
  ),

  [TrainingMode.Damper]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 10 },
      { phase: MovementPhase.HOLD, count: 2 },
      { phase: MovementPhase.ECCENTRIC, count: 14 },
    ],
    maxPosition: 600,
    buildValues: damperBuildValues,
  },

  [TrainingMode.CustomCurves]: standardProfile(
    [
      { phase: MovementPhase.IDLE, count: 4 },
      { phase: MovementPhase.CONCENTRIC, count: 11 },
      { phase: MovementPhase.HOLD, count: 3 },
      { phase: MovementPhase.ECCENTRIC, count: 15 },
    ],
    550,
    {
      concentricVelocityPeak: 65,
      eccentricVelocityPeak: 32,
      holdForceMultiplier: 0.5,
      concentricForce: (p, bf, f) => bf * Math.sin(p * Math.PI) * f,
      eccentricForce: (p, bf, f) => bf * Math.sin(p * Math.PI) * 0.8 * f,
    }
  ),

  [TrainingMode.Isokinetic]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 12 },
      { phase: MovementPhase.HOLD, count: 2 },
      { phase: MovementPhase.ECCENTRIC, count: 12 },
    ],
    maxPosition: 600,
    buildValues: isokineticBuildValues,
  },

  [TrainingMode.Isometric]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 20 },
    ],
    maxPosition: 0,
    buildValues: isometricBuildValues,
  },
};

export class MockBLEAdapter extends BaseBLEAdapter {
  private readonly config: Required<MockBLEConfig>;
  private telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;
  private repInSet = 0;
  private totalReps = 0;
  private activeMode: TrainingMode;
  private phaseIndex = 0;
  private sampleInPhase = 0;
  private resting = false;
  private restStart = 0;

  constructor(config?: MockBLEConfig) {
    super();
    this.config = { ...DEFAULTS, ...config };
    this.activeMode = this.config.trainingMode;
  }

  async scan(_timeout: number): Promise<Device[]> {
    await delay(this.config.scanDelayMs);
    return [
      {
        id: this.config.deviceId,
        name: this.config.deviceName,
        rssi: -50,
      },
    ];
  }

  async connect(_deviceId: string, _options?: ConnectOptions): Promise<void> {
    this.setConnectionState('connecting');
    await delay(this.config.connectDelayMs);
    this.setConnectionState('connected');
    this._startTelemetry();
  }

  async write(data: Uint8Array): Promise<void> {
    const detectedMode = this._detectModeCommand(data);
    if (detectedMode !== null) {
      this.setTrainingMode(detectedMode);
    }
  }

  async disconnect(): Promise<void> {
    this._stopTelemetry();
    this.setConnectionState('disconnected');
  }

  // ===========================================================================
  // Mode Switching
  // ===========================================================================

  /**
   * Switch the active training mode at runtime.
   * Resets phase/rep counters and emits a mode confirmation notification.
   */
  setTrainingMode(mode: TrainingMode): void {
    this.activeMode = mode;
    this._resetPhaseState();
    this._emitModeConfirmation(mode);
  }

  // ===========================================================================
  // Telemetry Simulation
  // ===========================================================================

  private _getProfile(): KinematicsProfile {
    return KINEMATICS_PROFILES[this.activeMode];
  }

  private _resetPhaseState(): void {
    this.phaseIndex = 0;
    this.sampleInPhase = 0;
    this.repInSet = 0;
    this.resting = false;
  }

  private _startTelemetry(): void {
    this.sequence = 0;
    this._resetPhaseState();
    this.totalReps = 0;

    this.telemetryInterval = setInterval(() => {
      if (this.resting) {
        if (Date.now() - this.restStart >= this.config.restBetweenSetsMs) {
          this.resting = false;
          this.repInSet = 0;
        } else {
          this._emitIdleFrame();
          return;
        }
      }

      const profile = this._getProfile();
      const phases = profile.phases;
      const lastPhaseIndex = phases.length - 1;

      const current = phases[this.phaseIndex];
      const progress = this.sampleInPhase / current.count;
      const fatigue = 1 - FATIGUE_RATE * this.repInSet;
      const baseForce = this.config.weight * 1.5;

      const { position, velocity, force } = profile.buildValues(
        current.phase,
        progress,
        fatigue,
        baseForce,
        profile.maxPosition
      );
      const frame = createFrame(this.sequence++, current.phase, position, force, velocity);
      this.emitNotification(encodeTelemetryFrame(frame));

      this.sampleInPhase++;

      if (this.sampleInPhase >= current.count) {
        this.sampleInPhase = 0;

        if (this.phaseIndex === lastPhaseIndex) {
          this.repInSet++;
          this.totalReps++;
          this._emitRepBoundary();

          if (this.repInSet >= this.config.repsPerSet) {
            this._emitSetBoundary();
            this.resting = true;
            this.restStart = Date.now();
          }
        }

        this.phaseIndex = (this.phaseIndex + 1) % phases.length;
      }
    }, SAMPLE_INTERVAL_MS);
  }

  private _stopTelemetry(): void {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
  }

  private _detectModeCommand(data: Uint8Array): TrainingMode | null {
    for (const mode of VALID_TRAINING_MODES) {
      const cmd = getModeCommand(mode);
      if (cmd && bytesEqual(data, cmd)) {
        return mode;
      }
    }
    return null;
  }

  private _emitIdleFrame(): void {
    const frame = createFrame(this.sequence++, MovementPhase.IDLE, 0, 0, 0);
    this.emitNotification(encodeTelemetryFrame(frame));
  }

  private _emitModeConfirmation(mode: TrainingMode): void {
    const config = NotificationConfigs.modeConfirmation;
    const length = config.length ?? 4;
    const data = new Uint8Array(length);
    const headerBytes = hexToBytes(config.header);
    data[0] = headerBytes[0];
    data[1] = headerBytes[1];
    if (config.valueOffset !== undefined) {
      data[config.valueOffset] = mode;
    }
    this.emitNotification(data);
  }

  private _emitRepBoundary(): void {
    const data = new Uint8Array(4);
    const header = MessageTypes.REP_SUMMARY;
    data[0] = header[0];
    data[1] = header[1];
    data[2] = header[2];
    data[3] = header[3];
    this.emitNotification(data);
  }

  private _emitSetBoundary(): void {
    const data = new Uint8Array(4);
    const header = MessageTypes.SET_SUMMARY;
    data[0] = header[0];
    data[1] = header[1];
    data[2] = header[2];
    data[3] = header[3];
    this.emitNotification(data);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
