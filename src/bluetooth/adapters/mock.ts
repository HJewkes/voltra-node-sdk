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

interface PhaseDef {
  phase: MovementPhase;
  count: number;
}

interface KinematicsProfile {
  phases: PhaseDef[];
  maxPosition: number;
  buildValues(
    phase: MovementPhase,
    progress: number,
    fatigue: number,
    baseForce: number,
    profile: KinematicsProfile
  ): { position: number; velocity: number; force: number };
}

function weightTrainingValues(
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  profile: KinematicsProfile
): { position: number; velocity: number; force: number } {
  let position = 0;
  let force = 0;
  let velocity = 0;

  switch (phase) {
    case MovementPhase.CONCENTRIC:
      position = Math.round(progress * profile.maxPosition);
      velocity = Math.round(Math.sin(progress * Math.PI) * 80 * fatigue);
      force = Math.round(baseForce * (1 - progress * 0.3) * fatigue);
      break;
    case MovementPhase.HOLD:
      position = profile.maxPosition;
      force = Math.round(baseForce * 0.5);
      break;
    case MovementPhase.ECCENTRIC:
      position = Math.round((1 - progress) * profile.maxPosition);
      velocity = Math.round(Math.sin(progress * Math.PI) * 40 * fatigue);
      force = Math.round(baseForce * 0.8 * (1 - progress * 0.2) * fatigue);
      break;
    default:
      break;
  }

  return { position, velocity, force };
}

function resistanceBandValues(
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  profile: KinematicsProfile
): { position: number; velocity: number; force: number } {
  let position = 0;
  let force = 0;
  let velocity = 0;

  switch (phase) {
    case MovementPhase.CONCENTRIC:
      position = Math.round(progress * profile.maxPosition);
      velocity = Math.round(Math.sin(progress * Math.PI) * 70 * fatigue);
      force = Math.round(baseForce * (0.4 + progress * 0.6) * fatigue);
      break;
    case MovementPhase.HOLD:
      position = profile.maxPosition;
      force = Math.round(baseForce * 0.9);
      break;
    case MovementPhase.ECCENTRIC:
      position = Math.round((1 - progress) * profile.maxPosition);
      velocity = Math.round(Math.sin(progress * Math.PI) * 35 * fatigue);
      force = Math.round(baseForce * (1.0 - progress * 0.6) * fatigue);
      break;
    default:
      break;
  }

  return { position, velocity, force };
}

function rowingValues(
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  profile: KinematicsProfile
): { position: number; velocity: number; force: number } {
  let position = 0;
  let force = 0;
  let velocity = 0;

  switch (phase) {
    case MovementPhase.CONCENTRIC:
      position = Math.round(progress * profile.maxPosition);
      velocity = Math.round(Math.sin(progress * Math.PI) * 50 * fatigue);
      force = Math.round(baseForce * Math.exp(-progress * 0.5) * fatigue);
      break;
    case MovementPhase.HOLD:
      position = profile.maxPosition;
      force = Math.round(baseForce * 0.3);
      break;
    case MovementPhase.ECCENTRIC:
      position = Math.round((1 - progress) * profile.maxPosition);
      velocity = Math.round(Math.sin(progress * Math.PI) * 25 * fatigue);
      force = Math.round(baseForce * 0.4 * fatigue);
      break;
    default:
      break;
  }

  return { position, velocity, force };
}

function damperValues(
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  profile: KinematicsProfile
): { position: number; velocity: number; force: number } {
  let position = 0;
  let velocity = 0;
  let force = 0;

  switch (phase) {
    case MovementPhase.CONCENTRIC: {
      position = Math.round(progress * profile.maxPosition);
      velocity = Math.round(Math.sin(progress * Math.PI) * 75 * fatigue);
      force = Math.round(velocity * baseForce * 0.02 * fatigue);
      break;
    }
    case MovementPhase.HOLD:
      position = profile.maxPosition;
      force = Math.round(baseForce * 0.1);
      break;
    case MovementPhase.ECCENTRIC: {
      position = Math.round((1 - progress) * profile.maxPosition);
      velocity = Math.round(Math.sin(progress * Math.PI) * 38 * fatigue);
      force = Math.round(velocity * baseForce * 0.015 * fatigue);
      break;
    }
    default:
      break;
  }

  return { position, velocity, force };
}

function customCurvesValues(
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  profile: KinematicsProfile
): { position: number; velocity: number; force: number } {
  let position = 0;
  let velocity = 0;
  let force = 0;

  switch (phase) {
    case MovementPhase.CONCENTRIC:
      position = Math.round(progress * profile.maxPosition);
      velocity = Math.round(Math.sin(progress * Math.PI) * 65 * fatigue);
      force = Math.round(baseForce * Math.sin(progress * Math.PI) * fatigue);
      break;
    case MovementPhase.HOLD:
      position = profile.maxPosition;
      force = Math.round(baseForce * 0.5);
      break;
    case MovementPhase.ECCENTRIC:
      position = Math.round((1 - progress) * profile.maxPosition);
      velocity = Math.round(Math.sin(progress * Math.PI) * 32 * fatigue);
      force = Math.round(baseForce * Math.sin(progress * Math.PI) * 0.8 * fatigue);
      break;
    default:
      break;
  }

  return { position, velocity, force };
}

function isokineticValues(
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  profile: KinematicsProfile
): { position: number; velocity: number; force: number } {
  const constantVelocity = 45;
  let position = 0;
  let velocity = 0;
  let force = 0;

  switch (phase) {
    case MovementPhase.CONCENTRIC:
      position = Math.round(progress * profile.maxPosition);
      velocity = constantVelocity;
      force = Math.round(baseForce * (0.8 + Math.sin(progress * Math.PI) * 0.4) * fatigue);
      break;
    case MovementPhase.HOLD:
      position = profile.maxPosition;
      force = Math.round(baseForce * 0.6);
      break;
    case MovementPhase.ECCENTRIC:
      position = Math.round((1 - progress) * profile.maxPosition);
      velocity = constantVelocity;
      force = Math.round(baseForce * (0.6 + Math.sin(progress * Math.PI) * 0.3) * fatigue);
      break;
    default:
      break;
  }

  return { position, velocity, force };
}

function isometricValues(
  _phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number
): { position: number; velocity: number; force: number } {
  const force = Math.round(
    baseForce * (0.7 + Math.sin(progress * Math.PI * 2) * 0.3) * fatigue
  );
  return { position: 0, velocity: 0, force };
}

const WEIGHT_TRAINING_PROFILE: KinematicsProfile = {
  phases: [
    { phase: MovementPhase.IDLE, count: 5 },
    { phase: MovementPhase.CONCENTRIC, count: 9 },
    { phase: MovementPhase.HOLD, count: 2 },
    { phase: MovementPhase.ECCENTRIC, count: 16 },
  ],
  maxPosition: 600,
  buildValues: weightTrainingValues,
};

const KINEMATICS_PROFILES: Record<TrainingMode, KinematicsProfile> = {
  [TrainingMode.Idle]: WEIGHT_TRAINING_PROFILE,
  [TrainingMode.WeightTraining]: WEIGHT_TRAINING_PROFILE,
  [TrainingMode.ResistanceBand]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 10 },
      { phase: MovementPhase.HOLD, count: 3 },
      { phase: MovementPhase.ECCENTRIC, count: 14 },
    ],
    maxPosition: 650,
    buildValues: resistanceBandValues,
  },
  [TrainingMode.Rowing]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 6 },
      { phase: MovementPhase.CONCENTRIC, count: 14 },
      { phase: MovementPhase.HOLD, count: 2 },
      { phase: MovementPhase.ECCENTRIC, count: 20 },
    ],
    maxPosition: 700,
    buildValues: rowingValues,
  },
  [TrainingMode.Damper]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 10 },
      { phase: MovementPhase.HOLD, count: 2 },
      { phase: MovementPhase.ECCENTRIC, count: 14 },
    ],
    maxPosition: 600,
    buildValues: damperValues,
  },
  [TrainingMode.CustomCurves]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 4 },
      { phase: MovementPhase.CONCENTRIC, count: 11 },
      { phase: MovementPhase.HOLD, count: 3 },
      { phase: MovementPhase.ECCENTRIC, count: 15 },
    ],
    maxPosition: 550,
    buildValues: customCurvesValues,
  },
  [TrainingMode.Isokinetic]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 12 },
      { phase: MovementPhase.HOLD, count: 2 },
      { phase: MovementPhase.ECCENTRIC, count: 12 },
    ],
    maxPosition: 600,
    buildValues: isokineticValues,
  },
  [TrainingMode.Isometric]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 20 },
    ],
    maxPosition: 0,
    buildValues: isometricValues,
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
        profile
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
