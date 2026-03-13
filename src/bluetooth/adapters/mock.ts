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
import { MovementPhase, TrainingMode } from '../../voltra/protocol/constants/enums';
import { createFrame } from '../../voltra/models/telemetry/frame';
import { encodeTelemetryFrame } from '../../voltra/protocol/telemetry-decoder';
import { KINEMATICS_PROFILES } from './mock/profiles';
import {
  buildIdleFrame,
  buildRepBoundary,
  buildSetBoundary,
  buildModeConfirmation,
  detectModeCommand,
} from './mock/notifications';
import type { MockBLEConfig, MockSessionConfig, PhaseDef } from './mock/types';
import { MOCK_DEFAULTS, SAMPLE_INTERVAL_MS, FATIGUE_RATE } from './mock/types';

// Re-export public types for backwards compatibility
export type { MockBLEConfig, MockSessionConfig } from './mock/types';
export {
  createMultiSetScenario,
  createPauseSetScenario,
  createTempoScenario,
  createShortRestScenario,
} from './mock/session-config';

export class MockBLEAdapter extends BaseBLEAdapter {
  private readonly config: Required<Omit<MockBLEConfig, 'sessionConfig'>>;
  private telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;
  private repInSet = 0;
  private totalReps = 0;
  private activeMode: TrainingMode;
  private phaseIndex = 0;
  private sampleInPhase = 0;
  private resting = false;
  private restStart = 0;

  private readonly sessionConfig: MockSessionConfig | null;
  private currentSet = 0;
  private fatigueReps = 0;
  private pauseClusterIndex = 0;
  private clusterRepCount = 0;
  private inPauseRest = false;
  private pauseStart = 0;

  constructor(config?: MockBLEConfig) {
    super();
    this.sessionConfig = config?.sessionConfig ?? null;
    this.config = { ...MOCK_DEFAULTS, ...config };
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
    const detectedMode = detectModeCommand(data);
    if (detectedMode !== null) {
      this.setTrainingMode(detectedMode);
    }
  }

  async disconnect(): Promise<void> {
    this._stopTelemetry();
    this.setConnectionState('disconnected');
  }

  /**
   * Switch the active training mode at runtime.
   * Resets phase/rep counters and emits a mode confirmation notification.
   */
  setTrainingMode(mode: TrainingMode): void {
    this.activeMode = mode;
    this._resetPhaseState();
    this.emitNotification(buildModeConfirmation(mode));
  }

  // ===========================================================================
  // Telemetry Simulation
  // ===========================================================================

  private _resetPhaseState(): void {
    this.phaseIndex = 0;
    this.sampleInPhase = 0;
    this.repInSet = 0;
    this.resting = false;
  }

  private _getEffectiveRepsPerSet(): number {
    return this.sessionConfig?.repsPerSet ?? this.config.repsPerSet;
  }

  private _getEffectiveRestMs(): number {
    return this.sessionConfig?.restBetweenSetsMs ?? this.config.restBetweenSetsMs;
  }

  private _applyTempoOverrides(phases: PhaseDef[]): PhaseDef[] {
    const tempo = this.sessionConfig?.tempo;
    if (!tempo) return phases;

    return phases.map((p) => {
      const { phase, count } = p;
      switch (phase) {
        case MovementPhase.CONCENTRIC:
          return { phase, count: tempo.concentricCount ?? count };
        case MovementPhase.HOLD:
          return { phase, count: tempo.holdCount ?? count };
        case MovementPhase.ECCENTRIC:
          return { phase, count: tempo.eccentricCount ?? count };
        case MovementPhase.IDLE:
          return { phase, count: tempo.idleCount ?? count };
        default:
          return p;
      }
    });
  }

  private _isPauseSet(): boolean {
    return this.sessionConfig?.pauseSet?.setIndex === this.currentSet;
  }

  private _handlePauseRest(): boolean {
    if (!this.inPauseRest) return false;

    if (Date.now() - this.pauseStart >= this.sessionConfig!.pauseSet!.pauseDurationMs) {
      this.inPauseRest = false;
      this.pauseClusterIndex++;
      this.clusterRepCount = 0;
      return false;
    }

    this.emitNotification(buildIdleFrame(this.sequence++));
    return true;
  }

  private _checkPauseTrigger(): boolean {
    const pauseSet = this.sessionConfig?.pauseSet;
    if (!pauseSet || !this._isPauseSet()) return false;
    if (this.pauseClusterIndex >= pauseSet.pauseAfterReps.length) return false;

    const targetReps = pauseSet.pauseAfterReps[this.pauseClusterIndex];
    if (this.clusterRepCount >= targetReps) {
      this.inPauseRest = true;
      this.pauseStart = Date.now();
      return true;
    }
    return false;
  }

  private _startTelemetry(): void {
    this.sequence = 0;
    this._resetPhaseState();
    this.totalReps = 0;
    this.currentSet = 0;
    this.fatigueReps = 0;
    this.pauseClusterIndex = 0;
    this.clusterRepCount = 0;
    this.inPauseRest = false;

    this.telemetryInterval = setInterval(() => {
      if (this._handlePauseRest()) return;

      if (this.resting) {
        if (Date.now() - this.restStart >= this._getEffectiveRestMs()) {
          this.resting = false;
          this.repInSet = 0;
        } else {
          this.emitNotification(buildIdleFrame(this.sequence++));
          return;
        }
      }

      const profile = KINEMATICS_PROFILES[this.activeMode];
      const phases = this._applyTempoOverrides(profile.phases);
      const lastPhaseIndex = phases.length - 1;

      const current = phases[this.phaseIndex];
      const progress = this.sampleInPhase / current.count;
      const fatigueSource = this.sessionConfig ? this.fatigueReps : this.repInSet;
      const fatigue = 1 - FATIGUE_RATE * fatigueSource;
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
          this.fatigueReps++;
          if (this._isPauseSet()) this.clusterRepCount++;
          this.emitNotification(buildRepBoundary());

          if (this._checkPauseTrigger()) {
            // Pause triggered — don't check set boundary yet
          } else if (this.repInSet >= this._getEffectiveRepsPerSet()) {
            this.emitNotification(buildSetBoundary());
            this.currentSet++;
            this.pauseClusterIndex = 0;
            this.clusterRepCount = 0;

            if (this.sessionConfig) {
              this.fatigueReps *= 1 - this.sessionConfig.interSetRecovery;
            }

            if (this.sessionConfig && this.currentSet >= this.sessionConfig.sets) {
              this._stopTelemetry();
              return;
            }

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
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
