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
 * 0.6.0 dropped the legacy `onRepBoundary` / `onSetBoundary` payload-less
 * callbacks. The four vendor-frame events surface exclusively through their
 * typed counterparts (`onPerRep`, `onInProgress`, `onSummary`, `onPreSummary`).
 */
export interface NotificationCallbacks {
  onFrame: (frame: TelemetryFrame) => void;
  onModeConfirmed: (mode: TrainingMode) => void;
  onSettingsUpdate: (settings: DeviceSettings) => void;
  onBatteryUpdate: (battery: number) => void;
  onPerRep: (event: PerRepEvent) => void;
  onSummary: (event: SummaryEvent) => void;
  onPreSummary: (event: PreSummaryEvent) => void;
  onInProgress: (event: InProgressEvent) => void;
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

      case 'perRep':
        callbacks.onPerRep(result.event);
        break;

      case 'inProgress':
        callbacks.onInProgress(result.event);
        break;

      case 'summary':
        callbacks.onSummary(result.event);
        break;

      case 'preSummary':
        callbacks.onPreSummary(result.event);
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
