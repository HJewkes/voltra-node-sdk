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
import { MovementPhase, TrainingMode } from '../../voltra/protocol/constants/enums';
import { createFrame } from '../../voltra/models/telemetry/frame';
import { encodeTelemetryFrame } from '../../voltra/protocol/telemetry-decoder';
import { KINEMATICS_PROFILES } from './mock/profiles';
import {
  buildIdleFrame,
  buildRepBoundary,
  buildSetBoundary,
  buildModeConfirmation,
  buildSettingsUpdate,
  detectModeCommand,
  detectSettingCommand,
  type DetectedSetting,
} from './mock/notifications';
import type {
  MockBLEConfig,
  MockSessionConfig,
  PhaseDef,
  PlannedRepProfile,
  ErrorScenarioType,
  ErrorConfig,
  MockBLEErrorConfig,
  DeviceParameterConfig,
  ResolvedDeviceParams,
} from './mock/types';
import {
  MOCK_DEFAULTS,
  SAMPLE_INTERVAL_MS,
  FATIGUE_RATE,
  DEVICE_PARAM_DEFAULTS,
  BATTERY_DRAIN_PER_MS,
  RSSI_NOISE_STD_DEV,
} from './mock/types';
import { ErrorInjector } from './mock/error-injector';

// Re-export public types for backwards compatibility
export type {
  MockBLEConfig,
  MockSessionConfig,
  PlannedRepProfile,
  ErrorScenarioType,
  ErrorConfig,
  MockBLEErrorConfig,
  DeviceParameterConfig,
  ResolvedDeviceParams,
} from './mock/types';
export {
  createMultiSetScenario,
  createPauseSetScenario,
  createTempoScenario,
  createShortRestScenario,
} from './mock/session-config';

export class MockBLEAdapter extends BaseBLEAdapter {
  // Mutable so `configure()` can override runtime-relevant fields mid-stream.
  // Connect-time fields (scanDelayMs, connectDelayMs, deviceId, deviceName)
  // remain effective only on subsequent connect cycles.
  private config: Required<Omit<MockBLEConfig, 'device' | 'sessionConfig'>>;
  private readonly deviceParams: ResolvedDeviceParams;
  private currentBattery: number;
  private motorEngagedSince: number | null = null;
  private telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private settingsSeedTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private repInSet = 0;
  private totalReps = 0;
  private activeMode: TrainingMode;
  private phaseIndex = 0;
  private sampleInPhase = 0;
  private resting = false;
  private restStart = 0;
  private readonly errorInjector: ErrorInjector;
  /**
   * Simulates the W3C Web Bluetooth `writeChar` handle. `simulateLinkLoss()`
   * nulls this to model `gattserverdisconnected` firing without the tracked
   * connection state being updated (Bug 30 reproducer).
   */
  private linkAlive = false;
  /**
   * Test helper queue: when non-null, the next `write()` call throws this
   * error WITHOUT touching `linkAlive`. Models a stuck GATT write pipe
   * (supervision-timeout-adjacent / MTU-window collapse) where the writeChar
   * handle is intact but the underlying queue rejects. Bug 30 follow-up
   * reproducer; see `feedback_ble_write_fail_reconnect_not_retry`.
   */
  private nextWriteError: Error | null = null;

  private readonly sessionConfig: MockSessionConfig | null;
  private currentSet = 0;
  private fatigueReps = 0;
  private pauseClusterIndex = 0;
  private clusterRepCount = 0;
  private inPauseRest = false;
  private pauseStart = 0;

  private repPlan: PlannedRepProfile[] | null = null;
  private repPlanStartTime = 0;

  constructor(config?: MockBLEConfig & MockBLEErrorConfig) {
    super();
    const { errorScenario, errorConfig, device, sessionConfig, ...bleConfig } = config ?? {};
    this.config = { ...MOCK_DEFAULTS, ...bleConfig };
    this.deviceParams = resolveDeviceParams(device);
    this.currentBattery = this.deviceParams.batteryLevel;
    this.sessionConfig = sessionConfig ?? null;
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
        rssi: this.getRssi(),
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
    this.linkAlive = true;
    this.setConnectionState('connected');
    this._startTelemetry();
    this._seedSettingsCascade();

    this.errorInjector.startTimers({
      triggerDisconnect: () => this._triggerDisconnect(),
      triggerReconnect: () => this._triggerReconnect(),
    });
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.nextWriteError) {
      const err = this.nextWriteError;
      this.nextWriteError = null;
      throw err;
    }
    if (!this.linkAlive) {
      throw new Error('Not connected to device');
    }
    const detectedMode = detectModeCommand(data);
    if (detectedMode !== null) {
      this.setTrainingMode(detectedMode);
      return;
    }
    const detectedSetting = detectSettingCommand(data);
    if (detectedSetting !== null) {
      this._applySetting(detectedSetting);
    }
  }

  /**
   * Honor a weight / chains write by updating simulated state and echoing the
   * cmd=0x10 settings-update cascade real hardware sends — the same path the
   * consumer reads user-set weight/chains from. Keeps mock faithful:
   * `setWeight(x)` surfaces `weightLbs === x` downstream, and the new weight
   * feeds telemetry force on subsequent frames.
   */
  private _applySetting(setting: DetectedSetting): void {
    if (setting.baseWeight !== undefined) {
      this.config.weight = setting.baseWeight;
    }
    this.emitNotification(buildSettingsUpdate(setting));
  }

  async disconnect(): Promise<void> {
    this.errorInjector.clearTimers();
    this._stopTelemetry();
    this.linkAlive = false;
    this.setConnectionState('disconnected');
  }

  /**
   * Report whether the simulated BLE link is alive end-to-end. Mirrors the
   * Web Bluetooth `writeChar !== null` check.
   */
  override isLinkAlive(): boolean {
    return this.linkAlive;
  }

  /**
   * Test helper: simulate the W3C `gattserverdisconnected` event firing
   * without the tracked connection state being updated. Reproduces the
   * state split documented in Bug 30 — `connectionState='connected'` while
   * the underlying write channel is gone. Used by regression tests.
   */
  simulateLinkLoss(): void {
    this.linkAlive = false;
  }

  /**
   * Test helper: cause the next `write()` to reject with the given error
   * while leaving `linkAlive` true. Models a jammed GATT write pipe where
   * the adapter believes the link is healthy but the firmware-side write
   * queue has stalled — observed on VTR-097082 2026-05-07T16-11-15
   * (`feedback_ble_write_fail_reconnect_not_retry`).
   */
  simulateWriteFailure(error: Error = new Error('Write failed')): void {
    this.nextWriteError = error;
  }

  /**
   * Test helper: simulate an unexpected adapter-level disconnect — equivalent
   * to `gattserverdisconnected` firing without a prior `client.disconnect()`.
   * The adapter's connection state is flipped to `'disconnected'` (which
   * fires `onConnectionStateChange` listeners) and the link is killed.
   *
   * Used by the slot-routing regression test
   * (`coordination/bug-investigations/ble-slot-routing-2026-05-08.md`,
   * Fix C in `sdk-slot-routing-code-trace-2026-05-08.md`) to verify that
   * `VoltraClient` observes adapter-level disconnects even when
   * `autoReconnect=false`.
   */
  simulateUnexpectedDisconnect(): void {
    this._stopTelemetry();
    this.errorInjector.clearTimers();
    this.linkAlive = false;
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

  /**
   * Set a deterministic rep plan that replaces normal fatigue-based phase cycling.
   * Each rep follows the exact timing and ROM specified in the profile.
   */
  setRepPlan(reps: PlannedRepProfile[]): void {
    this.repPlan = reps;
    this.repPlanStartTime = 0; // Lazy init on first sample
  }

  /** Revert to normal fatigue-based cycling. */
  clearRepPlan(): void {
    this.repPlan = null;
  }

  // ===========================================================================
  // Error Injection API
  // ===========================================================================

  /**
   * Update mock configuration at runtime. Runtime-relevant fields
   * (`trainingMode`, `repsPerSet`, `restBetweenSetsMs`, telemetry rates,
   * etc.) take effect immediately for the next emitted frame / boundary.
   * Connect-time fields (`scanDelayMs`, `connectDelayMs`, `deviceId`,
   * `deviceName`) only take effect on the next `scan` / `connect` call.
   * Pass only the fields you want to change; others are preserved.
   */
  configure(partial: Partial<Omit<MockBLEConfig, 'device' | 'sessionConfig'>>): void {
    this.config = { ...this.config, ...partial };
    if (partial.trainingMode !== undefined) {
      this.activeMode = partial.trainingMode;
    }
  }

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
  // Device Parameter API
  // ===========================================================================

  /**
   * Get the resolved device parameters (identity + simulation state).
   */
  getDeviceParams(): ResolvedDeviceParams {
    return { ...this.deviceParams, batteryLevel: this.getBatteryLevel() };
  }

  /**
   * Get the current battery level, accounting for drain during motor engagement.
   */
  getBatteryLevel(): number {
    if (this.motorEngagedSince === null) {
      return this.currentBattery;
    }
    const elapsed = Date.now() - this.motorEngagedSince;
    const drained = elapsed * BATTERY_DRAIN_PER_MS;
    return Math.max(0, this.currentBattery - drained);
  }

  /**
   * Get simulated RSSI with gaussian noise around the base value.
   */
  getRssi(): number {
    return this.deviceParams.rssi + gaussianNoise(RSSI_NOISE_STD_DEV);
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

  private _generateRepPlanSample(): void {
    const plan = this.repPlan!;
    // Lazy init: start timing from first sample, not from setRepPlan() call
    if (this.repPlanStartTime === 0) {
      this.repPlanStartTime = Date.now();
    }
    const elapsed = (Date.now() - this.repPlanStartTime) / 1000;

    let cursor = 0;
    for (const rep of plan) {
      const repDuration = rep.conSeconds + rep.holdSeconds + rep.eccSeconds + rep.idleSeconds;
      if (elapsed < cursor + repDuration) {
        const t = elapsed - cursor;
        let phase: MovementPhase;
        let position: number;
        let velocity: number;

        if (t < rep.conSeconds) {
          phase = MovementPhase.CONCENTRIC;
          const progress = t / rep.conSeconds;
          position = progress * rep.romMm;
          velocity = rep.romMm / rep.conSeconds;
        } else if (t < rep.conSeconds + rep.holdSeconds) {
          phase = MovementPhase.HOLD;
          position = rep.romMm;
          velocity = 0;
        } else if (t < rep.conSeconds + rep.holdSeconds + rep.eccSeconds) {
          phase = MovementPhase.ECCENTRIC;
          const eccElapsed = t - rep.conSeconds - rep.holdSeconds;
          const progress = eccElapsed / rep.eccSeconds;
          position = rep.romMm * (1 - progress);
          velocity = rep.romMm / rep.eccSeconds;
        } else {
          phase = MovementPhase.IDLE;
          position = 0;
          velocity = 0;
        }

        const force = velocity * 0.5;
        const frame = createFrame(this.sequence++, phase, position, force, velocity);
        this.emitNotification(encodeTelemetryFrame(frame));
        return;
      }
      cursor += repDuration;
    }

    // All reps consumed — stay in IDLE
    const frame = createFrame(this.sequence++, MovementPhase.IDLE, 0, 0, 0);
    this.emitNotification(encodeTelemetryFrame(frame));
  }

  private _startTelemetry(): void {
    this.sequence = 0;
    this._resetPhaseState();
    this.totalReps = 0;
    this._startBatteryDrain();
    this.currentSet = 0;
    this.fatigueReps = 0;
    this.pauseClusterIndex = 0;
    this.clusterRepCount = 0;
    this.inPauseRest = false;

    this.telemetryInterval = setInterval(() => {
      if (this.repPlan) {
        this._generateRepPlanSample();
        return;
      }
      if (this._handlePauseRest()) return;

      if (this.resting) {
        if (Date.now() - this.restStart >= this._getEffectiveRestMs()) {
          this.resting = false;
          this.repInSet = 0;
        } else {
          this._emitWithErrorFilter(buildIdleFrame(this.sequence++));
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
      this._emitWithErrorFilter(encodeTelemetryFrame(frame));

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

  private _emitWithErrorFilter(data: Uint8Array): void {
    const filtered = this.errorInjector.filterNotification(data);
    if (filtered !== null) {
      this.emitNotification(filtered);
    }
  }

  /**
   * Emit the device's current weight setting as a cmd=0x10 settings-update
   * cascade one tick after connect, mirroring how real hardware surfaces its
   * persisted settings post-bootstrap. Deferred a tick because the consumer's
   * notification handler is subscribed only AFTER `adapter.connect()` resolves
   * (see `VoltraClient.connect`); a synchronous emit here would be dropped.
   * Without this, `weightLbs` stays null under mock until an explicit
   * setWeight, blocking no-hardware verification of mass/force readouts.
   */
  private _seedSettingsCascade(): void {
    this.settingsSeedTimer = setTimeout(() => {
      this.settingsSeedTimer = null;
      if (this.linkAlive) {
        this.emitNotification(buildSettingsUpdate({ baseWeight: this.config.weight }));
      }
    }, 0);
  }

  private _stopTelemetry(): void {
    if (this.settingsSeedTimer) {
      clearTimeout(this.settingsSeedTimer);
      this.settingsSeedTimer = null;
    }
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
    this._stopBatteryDrain();
  }

  private _startBatteryDrain(): void {
    this.motorEngagedSince = Date.now();
  }

  private _stopBatteryDrain(): void {
    if (this.motorEngagedSince !== null) {
      this.currentBattery = this.getBatteryLevel();
      this.motorEngagedSince = null;
    }
  }

  private _triggerDisconnect(): void {
    this._stopTelemetry();
    this.linkAlive = false;
    this.setConnectionState('disconnected');
  }

  private _triggerReconnect(): void {
    this.setConnectionState('connecting');
    this.linkAlive = true;
    this.setConnectionState('connected');
    this._startTelemetry();
    this._seedSettingsCascade();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDeviceParams(config?: DeviceParameterConfig): ResolvedDeviceParams {
  return { ...DEVICE_PARAM_DEFAULTS, ...config };
}

/**
 * Box-Muller transform: generates gaussian-distributed random values.
 */
function gaussianNoise(stdDev: number): number {
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random();
  return stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
