/**
 * Device-state model + event reducer backing `useVoltraDevice`.
 *
 * Kept free of any React import so the state-transition behavior (the
 * `isReconnecting` flag across an auto-reconnect, error preservation across
 * a disconnect) is unit-testable without a React renderer or the optional
 * `react` peer dependency.
 */

import type { TelemetryFrame } from '../voltra/models/telemetry';
import type { VoltraConnectionState } from '../voltra/models/connection';
import { DEFAULT_SETTINGS } from '../voltra/models/device';
import type { VoltraDeviceSettings, VoltraRecordingState } from '../voltra/models/device';
import type { VoltraClient } from '../sdk/voltra-client';
import type { VoltraClientEvent } from '../sdk/types';

/**
 * Device state.
 */
export interface VoltraDeviceState {
  /** Current connection state */
  connectionState: VoltraConnectionState;
  /** Whether connected */
  isConnected: boolean;
  /** Whether an automatic reconnect is in progress */
  isReconnecting: boolean;
  /** Current recording state */
  recordingState: VoltraRecordingState;
  /** Whether recording is active */
  isRecording: boolean;
  /** Current device settings */
  settings: VoltraDeviceSettings;
  /** Most recent telemetry frame */
  currentFrame: TelemetryFrame | null;
  /** Last error, if any */
  error: Error | null;
}

export const DEFAULT_DEVICE_STATE: VoltraDeviceState = {
  connectionState: 'disconnected',
  isConnected: false,
  isReconnecting: false,
  recordingState: 'idle',
  isRecording: false,
  settings: DEFAULT_SETTINGS,
  currentFrame: null,
  error: null,
};

/**
 * Fold a single `VoltraClientEvent` into the device state.
 *
 * `client` is used only to read the latest settings on `'connected'`.
 */
export function reduceVoltraDeviceEvent(
  prev: VoltraDeviceState,
  event: VoltraClientEvent,
  client: Pick<VoltraClient, 'settings'>
): VoltraDeviceState {
  switch (event.type) {
    case 'connectionStateChanged':
      return {
        ...prev,
        connectionState: event.state,
        isConnected: event.state === 'connected',
      };

    case 'recordingStateChanged':
      return { ...prev, recordingState: event.state, isRecording: event.state === 'active' };

    case 'frame':
      return { ...prev, currentFrame: event.frame };

    case 'error':
      return { ...prev, error: event.error };

    case 'reconnecting':
      return { ...prev, isReconnecting: true };

    case 'connected':
      return { ...prev, settings: client.settings, isReconnecting: false, error: null };

    case 'disconnected':
      // Reset to defaults but PRESERVE the last error — an error that
      // accompanies a disconnect must not be wiped by this event.
      return { ...DEFAULT_DEVICE_STATE, error: prev.error };

    default:
      return prev;
  }
}
