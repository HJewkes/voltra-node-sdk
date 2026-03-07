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
 *
 * Supports optional error injection for robustness testing via constructor
 * config or dynamic `injectError()` / `clearErrors()` methods.
 */

import { BaseBLEAdapter } from './base';
import type { Device, ConnectOptions } from './types';
import { TrainingMode } from '../../voltra/protocol/constants/enums';
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
import type { MockBLEConfig, ErrorScenarioType, ErrorConfig, MockBLEErrorConfig } from './mock/types';
import { MOCK_DEFAULTS, SAMPLE_INTERVAL_MS, FATIGUE_RATE } from './mock/types';
import { ErrorInjector } from './mock/error-injector';

// Re-export public types for backwards compatibility
export type { MockBLEConfig, ErrorScenarioType, ErrorConfig, MockBLEErrorConfig } from './mock/types';

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
  private readonly errorInjector: ErrorInjector;

  constructor(config?: MockBLEConfig & MockBLEErrorConfig) {
    super();
    const { errorScenario, errorConfig, ...bleConfig } = config ?? {};
    this.config = { ...MOCK_DEFAULTS, ...bleConfig };
    this.activeMode = this.config.trainingMode;
    this.errorInjector = new ErrorInjector();

    if (errorScenario && errorConfig) {
      this.errorInjector.inject(errorScenario, errorConfig);
    }
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
    const authTimeout = this.errorInjector.shouldBlockAuth();
    if (authTimeout) {
      this.setConnectionState('connecting');
      const timeoutMs = authTimeout.timeoutMs ?? 10_000;
      await delay(timeoutMs);
      this.setConnectionState('disconnected');
      throw new Error('Authentication timed out');
    }

    this.setConnectionState('connecting');
    await delay(this.config.connectDelayMs);
    this.setConnectionState('connected');
    this._startTelemetry();

    this.errorInjector.startTimers({
      triggerDisconnect: () => this._triggerDisconnect(),
      triggerReconnect: () => this._triggerReconnect(),
    });
  }

  async write(data: Uint8Array): Promise<void> {
    const detectedMode = detectModeCommand(data);
    if (detectedMode !== null) {
      this.setTrainingMode(detectedMode);
    }
  }

  async disconnect(): Promise<void> {
    this.errorInjector.clearTimers();
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
  // Error Injection API
  // ===========================================================================

  /**
   * Inject an error scenario dynamically (can be called mid-test).
   * Multiple error types can be composed by calling this multiple times.
   */
  injectError(type: ErrorScenarioType, config: ErrorConfig): void {
    this.errorInjector.inject(type, config);

    if (this.isConnected() && (type === 'disconnect' || type === 'reconnectCycle')) {
      this.errorInjector.startTimers({
        triggerDisconnect: () => this._triggerDisconnect(),
        triggerReconnect: () => this._triggerReconnect(),
      });
    }
  }

  /**
   * Clear all injected errors and restore normal behavior.
   */
  clearErrors(): void {
    this.errorInjector.clearAll();
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
          this._emitWithErrorFilter(buildIdleFrame(this.sequence++));
          return;
        }
      }

      const profile = KINEMATICS_PROFILES[this.activeMode];
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
      this._emitWithErrorFilter(encodeTelemetryFrame(frame));

      this.sampleInPhase++;

      if (this.sampleInPhase >= current.count) {
        this.sampleInPhase = 0;

        if (this.phaseIndex === lastPhaseIndex) {
          this.repInSet++;
          this.totalReps++;
          this.emitNotification(buildRepBoundary());

          if (this.repInSet >= this.config.repsPerSet) {
            this.emitNotification(buildSetBoundary());
            this.resting = true;
            this.restStart = Date.now();
          }
        }

        this.phaseIndex = (this.phaseIndex + 1) % phases.length;
      }
    }, SAMPLE_INTERVAL_MS);
  }

  private _emitWithErrorFilter(data: Uint8Array): void {
    const filtered = this.errorInjector.filterNotification(data);
    if (filtered !== null) {
      this.emitNotification(filtered);
    }
  }

  private _stopTelemetry(): void {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
  }

  private _triggerDisconnect(): void {
    this._stopTelemetry();
    this.setConnectionState('disconnected');
  }

  private _triggerReconnect(): void {
    this.setConnectionState('connecting');
    this.setConnectionState('connected');
    this._startTelemetry();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
