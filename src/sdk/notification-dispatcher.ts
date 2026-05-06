/**
 * Notification Dispatcher
 *
 * Decodes BLE notifications and dispatches to typed callbacks.
 * Extracted from VoltraClient for modularity.
 */

import type { NotificationCallback } from '../bluetooth/adapters/types';
import type { TelemetryFrame } from '../voltra/models/telemetry';
import type { TrainingMode } from '../voltra/protocol/constants';
import type { DeviceSettings } from '../voltra/protocol/types';
import { decodeNotification } from '../voltra/protocol/telemetry-decoder';
import type { PerRepEvent, SummaryEvent, PreSummaryEvent, InProgressEvent } from './types';

/**
 * Callbacks for each notification type.
 *
 * The four typed vendor-frame callbacks are optional so existing 0.5.x
 * consumers and test mocks don't need to implement them. They fan out
 * IN ADDITION to the legacy `onRepBoundary` / `onSetBoundary` callbacks
 * for backward compatibility.
 */
export interface NotificationCallbacks {
  onFrame: (frame: TelemetryFrame) => void;
  /**
   * Legacy payload-less rep-boundary callback. Fires for every `perRep`
   * frame (i.e. twice per rep) alongside `onPerRep`.
   */
  onRepBoundary: () => void;
  /**
   * @deprecated Fires on every `inProgress` heartbeat (~1 Hz) alongside
   * `onInProgress` for backward compatibility. Prefer `onInProgress` for
   * typed payload access. Removal deferred to 0.7.0.
   */
  onSetBoundary: () => void;
  onModeConfirmed: (mode: TrainingMode) => void;
  onSettingsUpdate: (settings: DeviceSettings) => void;
  onBatteryUpdate: (battery: number) => void;
  // Typed vendor-frame callbacks (0.6.0+, optional)
  onPerRep?: (event: PerRepEvent) => void;
  onSummary?: (event: SummaryEvent) => void;
  onPreSummary?: (event: PreSummaryEvent) => void;
  onInProgress?: (event: InProgressEvent) => void;
}

/**
 * Create a BLE notification handler that decodes and dispatches to typed callbacks.
 *
 * @param callbacks Typed callbacks for each notification type
 * @returns NotificationCallback to pass to adapter.onNotification()
 */
export function createNotificationHandler(callbacks: NotificationCallbacks): NotificationCallback {
  return (data: Uint8Array) => {
    const result = decodeNotification(data);
    if (!result) return;

    switch (result.type) {
      case 'frame':
        callbacks.onFrame(result.frame);
        break;

      case 'rep_boundary':
        callbacks.onRepBoundary();
        break;

      case 'set_boundary':
        callbacks.onSetBoundary();
        break;

      case 'perRep':
        callbacks.onPerRep?.(result.event);
        // Legacy fan-out preserves 0.5.0 onRepBoundary semantics.
        callbacks.onRepBoundary();
        break;

      case 'inProgress':
        callbacks.onInProgress?.(result.event);
        // Legacy fan-out preserves 0.5.0 onSetBoundary semantics.
        callbacks.onSetBoundary();
        break;

      case 'summary':
        callbacks.onSummary?.(result.event);
        break;

      case 'preSummary':
        callbacks.onPreSummary?.(result.event);
        break;

      case 'mode_confirmation':
        callbacks.onModeConfirmed(result.mode);
        break;

      case 'settings_update':
        callbacks.onSettingsUpdate(result.settings);
        break;

      case 'device_status':
        callbacks.onBatteryUpdate(result.battery);
        break;

      case 'unknown':
        // Silently ignore unknown notifications
        break;
    }
  };
}
