/**
 * Voltra Device Model
 *
 * Represents a Voltra device with its identity, settings, and connection state.
 */

import { type VoltraConnectionState } from './connection';

/**
 * Voltra device settings.
 */
export interface VoltraDeviceSettings {
  /** Weight in pounds (5-200 in increments of 5) */
  weight: number;
  /** Chains (reverse resistance) in pounds (0-100) */
  chains: number;
  /** Eccentric load adjustment (-195 to +195) */
  eccentric: number;
}

/**
 * Recording state for a Voltra device.
 *
 * A "recording" is when the device is actively streaming telemetry data,
 * typically during a single set. This is distinct from a "workout" which
 * refers to the full training session containing multiple sets/exercises.
 */
export type VoltraRecordingState = 'idle' | 'preparing' | 'ready' | 'active' | 'stopping';

/**
 * Voltra device state snapshot.
 */
export interface VoltraDeviceState {
  // Identity
  deviceId: string;
  deviceName: string | null;

  // Connection
  connectionState: VoltraConnectionState;
  isReconnecting: boolean;

  // Settings
  settings: VoltraDeviceSettings;

  // Recording (active telemetry streaming)
  recordingState: VoltraRecordingState;
  recordingStartTime: number | null;

  // Error
  error: string | null;
}

/**
 * Default settings for a new device.
 */
export const DEFAULT_SETTINGS: VoltraDeviceSettings = {
  weight: 0,
  chains: 0,
  eccentric: 0,
};

/**
 * Voltra device model.
 *
 * Represents a single Voltra device with its state and settings.
 * This is a pure model with no async operations.
 */
export class VoltraDevice {
  private _deviceId: string;
  private _deviceName: string | null;
  private _settings: VoltraDeviceSettings;
  private _connectionState: VoltraConnectionState;
  private _isReconnecting: boolean;
  private _recordingState: VoltraRecordingState;
  private _recordingStartTime: number | null;
  private _error: string | null;

  constructor(deviceId: string, deviceName?: string | null) {
    this._deviceId = deviceId;
    this._deviceName = deviceName ?? null;
    this._settings = { ...DEFAULT_SETTINGS };
    this._connectionState = 'disconnected';
    this._isReconnecting = false;
    this._recordingState = 'idle';
    this._recordingStartTime = null;
    this._error = null;
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  get deviceId(): string {
    return this._deviceId;
  }

  get deviceName(): string | null {
    return this._deviceName;
  }

  get settings(): VoltraDeviceSettings {
    return { ...this._settings };
  }

  get weight(): number {
    return this._settings.weight;
  }

  get chains(): number {
    return this._settings.chains;
  }

  get eccentric(): number {
    return this._settings.eccentric;
  }

  get connectionState(): VoltraConnectionState {
    return this._connectionState;
  }

  get isConnected(): boolean {
    return this._connectionState === 'connected';
  }

  get isReconnecting(): boolean {
    return this._isReconnecting;
  }

  get recordingState(): VoltraRecordingState {
    return this._recordingState;
  }

  get isRecording(): boolean {
    return this._recordingState === 'active';
  }

  get recordingStartTime(): number | null {
    return this._recordingStartTime;
  }

  get error(): string | null {
    return this._error;
  }

  // ==========================================================================
  // State Updates
  // ==========================================================================

  /**
   * Update device settings.
   */
  updateSettings(settings: Partial<VoltraDeviceSettings>): void {
    this._settings = { ...this._settings, ...settings };
  }

  /**
   * Set connection state.
   */
  setConnectionState(state: VoltraConnectionState): void {
    this._connectionState = state;
  }

  /**
   * Set reconnecting flag.
   */
  setReconnecting(value: boolean): void {
    this._isReconnecting = value;
  }

  /**
   * Set recording state.
   */
  setRecordingState(state: VoltraRecordingState): void {
    this._recordingState = state;
    if (state === 'active') {
      this._recordingStartTime = Date.now();
    } else if (state === 'idle') {
      this._recordingStartTime = null;
    }
  }

  /**
   * Set error message.
   */
  setError(error: string | null): void {
    this._error = error;
  }

  /**
   * Clear error.
   */
  clearError(): void {
    this._error = null;
  }

  // ==========================================================================
  // Serialization
  // ==========================================================================

  /**
   * Get a snapshot of the device state.
   */
  toState(): VoltraDeviceState {
    return {
      deviceId: this._deviceId,
      deviceName: this._deviceName,
      connectionState: this._connectionState,
      isReconnecting: this._isReconnecting,
      settings: { ...this._settings },
      recordingState: this._recordingState,
      recordingStartTime: this._recordingStartTime,
      error: this._error,
    };
  }

  /**
   * Reset device to initial state (keeps identity).
   */
  reset(): void {
    this._settings = { ...DEFAULT_SETTINGS };
    this._connectionState = 'disconnected';
    this._isReconnecting = false;
    this._recordingState = 'idle';
    this._recordingStartTime = null;
    this._error = null;
  }
}
