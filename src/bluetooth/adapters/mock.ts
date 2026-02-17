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
import { MovementPhase } from '../../voltra/protocol/constants/enums';
import { MessageTypes } from '../../voltra/protocol/constants/message-types';
import { createFrame, type TelemetryFrame } from '../../voltra/models/telemetry/frame';
import { encodeTelemetryFrame } from '../../voltra/protocol/telemetry-decoder';

export interface MockBLEConfig {
  deviceName?: string;
  deviceId?: string;
  scanDelayMs?: number;
  connectDelayMs?: number;
  /** Weight in lbs — affects force values */
  weight?: number;
  repsPerSet?: number;
  restBetweenSetsMs?: number;
}

const DEFAULTS = {
  deviceName: 'VTR-Mock',
  deviceId: 'mock-voltra-001',
  scanDelayMs: 200,
  connectDelayMs: 300,
  weight: 100,
  repsPerSet: 5,
  restBetweenSetsMs: 3000,
} as const;

// Phase durations in sample counts at ~11Hz
const PHASE_SAMPLES = {
  idle: 5,
  concentric: 9,
  hold: 2,
  eccentric: 16,
} as const;

const SAMPLE_INTERVAL_MS = 91; // ~11Hz
const MAX_POSITION = 600;
const BASE_CONCENTRIC_VELOCITY = 80;
const BASE_ECCENTRIC_VELOCITY = 40;
const FATIGUE_RATE = 0.03;

export class MockBLEAdapter extends BaseBLEAdapter {
  private readonly config: Required<MockBLEConfig>;
  private telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;
  private repInSet = 0;
  private totalReps = 0;

  constructor(config?: MockBLEConfig) {
    super();
    this.config = { ...DEFAULTS, ...config };
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

  async write(_data: Uint8Array): Promise<void> {
    // Auth/init writes succeed silently
  }

  async disconnect(): Promise<void> {
    this._stopTelemetry();
    this.setConnectionState('disconnected');
  }

  // ===========================================================================
  // Telemetry Simulation
  // ===========================================================================

  private _startTelemetry(): void {
    this.sequence = 0;
    this.repInSet = 0;
    this.totalReps = 0;

    let phaseIndex = 0;
    let sampleInPhase = 0;
    let resting = false;
    let restStart = 0;

    const phases: { phase: MovementPhase; count: number }[] = [
      { phase: MovementPhase.IDLE, count: PHASE_SAMPLES.idle },
      { phase: MovementPhase.CONCENTRIC, count: PHASE_SAMPLES.concentric },
      { phase: MovementPhase.HOLD, count: PHASE_SAMPLES.hold },
      { phase: MovementPhase.ECCENTRIC, count: PHASE_SAMPLES.eccentric },
    ];

    this.telemetryInterval = setInterval(() => {
      // Rest period between sets
      if (resting) {
        if (Date.now() - restStart >= this.config.restBetweenSetsMs) {
          resting = false;
          this.repInSet = 0;
        } else {
          this._emitIdleFrame();
          return;
        }
      }

      const current = phases[phaseIndex];
      const progress = sampleInPhase / current.count;
      const fatigue = 1 - FATIGUE_RATE * this.repInSet;
      const baseForce = this.config.weight * 1.5;

      const frame = this._buildFrame(current.phase, progress, fatigue, baseForce);
      this.emitNotification(encodeTelemetryFrame(frame));

      sampleInPhase++;

      // Phase transition
      if (sampleInPhase >= current.count) {
        sampleInPhase = 0;

        // Completed eccentric -> rep done
        if (current.phase === MovementPhase.ECCENTRIC) {
          this.repInSet++;
          this.totalReps++;
          this._emitRepBoundary();

          // Set boundary
          if (this.repInSet >= this.config.repsPerSet) {
            this._emitSetBoundary();
            resting = true;
            restStart = Date.now();
          }
        }

        phaseIndex = (phaseIndex + 1) % phases.length;
      }
    }, SAMPLE_INTERVAL_MS);
  }

  private _stopTelemetry(): void {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
  }

  private _buildFrame(
    phase: MovementPhase,
    progress: number,
    fatigue: number,
    baseForce: number
  ): TelemetryFrame {
    let position = 0;
    let force = 0;
    let velocity = 0;

    switch (phase) {
      case MovementPhase.CONCENTRIC:
        position = Math.round(progress * MAX_POSITION);
        velocity = Math.round(Math.sin(progress * Math.PI) * BASE_CONCENTRIC_VELOCITY * fatigue);
        force = Math.round(baseForce * (1 - progress * 0.3) * fatigue);
        break;

      case MovementPhase.HOLD:
        position = MAX_POSITION;
        force = Math.round(baseForce * 0.5);
        break;

      case MovementPhase.ECCENTRIC:
        position = Math.round((1 - progress) * MAX_POSITION);
        velocity = Math.round(Math.sin(progress * Math.PI) * BASE_ECCENTRIC_VELOCITY * fatigue);
        force = Math.round(baseForce * 0.8 * (1 - progress * 0.2) * fatigue);
        break;

      case MovementPhase.IDLE:
      default:
        break;
    }

    return createFrame(this.sequence++, phase, position, force, velocity);
  }

  private _emitIdleFrame(): void {
    const frame = createFrame(this.sequence++, MovementPhase.IDLE, 0, 0, 0);
    this.emitNotification(encodeTelemetryFrame(frame));
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
