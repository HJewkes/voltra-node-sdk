/**
 * Notification Dispatcher
 *
 * Decodes BLE notifications and dispatches to typed callbacks.
 * Extracted from VoltraClient for modularity.
 */

import type { NotificationCallback } from '../bluetooth/adapters/types';
import { FrameReassembler } from './frame-reassembler';
import type { TelemetryFrame } from '../voltra/models/telemetry';
import type { TrainingMode } from '../voltra/protocol/constants';
import type { DeviceSettings, StateDumpEvent } from '../voltra/protocol/types';
import { decodeNotification } from '../voltra/protocol/telemetry-decoder';
import type { PerRepEvent, SummaryEvent, SetSummaryEvent, InProgressEvent } from './types';

/**
 * Callbacks for each notification type.
 *
 * 0.6.0 dropped the legacy `onRepBoundary` / `onSetBoundary` payload-less
 * callbacks. The four vendor-frame events surface exclusively through their
 * typed counterparts (`onPerRep`, `onInProgress`, `onSummary`, `onSetSummary`).
 *
 * 0.6.2 adds `onRawFrame` — fires for every inbound notification BEFORE
 * decode, including frames that decode to `'unknown'`. Diagnostic / capture
 * surface for byte-level work (frame reconnaissance, bootstrap parity).
 */
export interface NotificationCallbacks {
  onRawFrame: (data: Uint8Array) => void;
  onFrame: (frame: TelemetryFrame) => void;
  onModeConfirmed: (mode: TrainingMode) => void;
  onSettingsUpdate: (settings: DeviceSettings) => void;
  onStateDump: (event: StateDumpEvent) => void;
  onBatteryUpdate: (battery: number) => void;
  onPerRep: (event: PerRepEvent) => void;
  onSummary: (event: SummaryEvent) => void;
  onSetSummary: (event: SetSummaryEvent) => void;
  onInProgress: (event: InProgressEvent) => void;
  /** VW-403: the device's own report of whether it accepted the connection. */
  onConnectionAcceptance: (accepted: boolean, status: number) => void;
}

/**
 * Create a BLE notification handler that decodes and dispatches to typed callbacks.
 *
 * The handler owns a receive buffer, so it must not be shared between devices.
 * {@link NotificationCallbacks.onRawFrame} still fires once per notification,
 * before reassembly, so byte-level consumers keep seeing the transport
 * exactly as it arrived.
 *
 * @param callbacks Typed callbacks for each notification type
 * @returns NotificationCallback to pass to adapter.onNotification()
 */
export function createNotificationHandler(callbacks: NotificationCallbacks): NotificationCallback {
  const reassembler = new FrameReassembler();

  return (data: Uint8Array) => {
    // Fire raw-frame callback first so consumers can capture bytes for
    // every inbound notification, including frames the decoder cannot
    // classify (e.g. async-update family until 1a lands).
    callbacks.onRawFrame(data);

    reassembler.push(data, (frame) => dispatchFrame(frame, callbacks));
  };
}

/** Decode one whole frame and hand it to the callback it belongs to. */
function dispatchFrame(data: Uint8Array, callbacks: NotificationCallbacks): void {
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

    case 'setSummary':
      callbacks.onSetSummary(result.event);
      break;

    case 'mode_confirmation':
      callbacks.onModeConfirmed(result.mode);
      break;

    case 'settings_update':
      callbacks.onSettingsUpdate(result.settings);
      // Battery rides in on the same report as every other register, so it
      // reaches its own callback from here rather than from a frame shape.
      if (result.settings.battery !== undefined) {
        callbacks.onBatteryUpdate(result.settings.battery);
      }
      break;

    case 'state_dump':
      callbacks.onStateDump(result.event);
      break;

    case 'connection_acceptance':
      callbacks.onConnectionAcceptance(result.accepted, result.status);
      break;

    case 'unknown':
      // Silently ignore unknown notifications
      break;
  }
}
