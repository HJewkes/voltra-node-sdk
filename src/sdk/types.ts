/**
 * SDK Types
 *
 * Types for the high-level VoltraClient API.
 */

import type { BLEAdapter } from '../bluetooth/adapters/types';
import type { DiscoveredDevice } from '../bluetooth/models/device';
import type { TelemetryFrame } from '../voltra/models/telemetry';
import type { VoltraConnectionState } from '../voltra/models/connection';
import type { VoltraDeviceSettings, VoltraRecordingState } from '../voltra/models/device';
import type { TrainingMode } from '../voltra/protocol/constants';
import type { DeviceSettings } from '../voltra/protocol/types';

/**
 * Options for creating a VoltraClient.
 */
export interface VoltraClientOptions {
  /**
   * Pre-configured BLE adapter to use.
   * If not provided, you must call setAdapter() before connecting.
   */
  adapter?: BLEAdapter;

  /**
   * Enable auto-reconnect on connection loss.
   * Default: false
   */
  autoReconnect?: boolean;

  /**
   * Maximum number of reconnect attempts.
   * Default: 3
   */
  maxReconnectAttempts?: number;

  /**
   * Delay between reconnect attempts in milliseconds.
   * Default: 1000
   */
  reconnectDelayMs?: number;
}

/**
 * Options for scanning for devices.
 */
export interface ScanOptions {
  /**
   * Scan timeout in milliseconds.
   * Default: 10000 (10 seconds)
   */
  timeout?: number;

  /**
   * Only return Voltra devices (filter by name prefix).
   * Default: true
   */
  filterVoltra?: boolean;
}

/**
 * Client event types.
 */
export type VoltraClientEvent =
  // Connection events
  | { type: 'connectionStateChanged'; state: VoltraConnectionState }
  | { type: 'connected'; deviceId: string; deviceName: string | null }
  | { type: 'disconnected'; deviceId: string }
  | { type: 'reconnecting'; attempt: number; maxAttempts: number }
  // Recording events
  | { type: 'recordingStateChanged'; state: VoltraRecordingState }
  // Telemetry events
  | { type: 'frame'; frame: TelemetryFrame }
  // Workout boundary events
  | { type: 'repBoundary' }
  | { type: 'setBoundary' }
  // Device notification events
  | { type: 'modeConfirmed'; mode: TrainingMode }
  | { type: 'settingsUpdate'; settings: DeviceSettings }
  | { type: 'batteryUpdate'; battery: number }
  // Error events
  | { type: 'error'; error: Error };

/**
 * Client event listener.
 */
export type VoltraClientEventListener = (event: VoltraClientEvent) => void;

/**
 * Frame listener (shorthand for subscribing to telemetry frames).
 */
export type FrameListener = (frame: TelemetryFrame) => void;

/**
 * Rep boundary listener (called when device signals rep completion).
 */
export type RepBoundaryListener = () => void;

/**
 * Set boundary listener (called when device signals set completion).
 */
export type SetBoundaryListener = () => void;

/**
 * Mode confirmed listener (called when device confirms mode change).
 */
export type ModeConfirmedListener = (mode: TrainingMode) => void;

/**
 * Settings update listener (called when device reports current settings).
 */
export type SettingsUpdateListener = (settings: DeviceSettings) => void;

/**
 * Battery update listener (called when device reports battery level).
 */
export type BatteryUpdateListener = (battery: number) => void;

/**
 * State snapshot of the client.
 */
export interface VoltraClientState {
  connectionState: VoltraConnectionState;
  isConnected: boolean;
  isReconnecting: boolean;
  connectedDeviceId: string | null;
  connectedDeviceName: string | null;
  settings: VoltraDeviceSettings;
  recordingState: VoltraRecordingState;
  isRecording: boolean;
  error: Error | null;
}

/**
 * Device chooser function for programmatic device selection (Node.js).
 */
export type DeviceChooser = (devices: DiscoveredDevice[]) => DiscoveredDevice | null;
