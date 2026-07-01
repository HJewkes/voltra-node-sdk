/**
 * SDK-01.10 — useVoltraDevice state-transition behavior.
 *
 * Exercises the pure event reducer that backs the hook (no React renderer
 * needed): the `isReconnecting` flag across an auto-reconnect sequence, and
 * error preservation across a disconnect.
 */
import { describe, it, expect } from 'vitest';
import { reduceVoltraDeviceEvent, type VoltraDeviceState } from '../device-state';
import { DEFAULT_SETTINGS } from '../../voltra/models/device';
import type { VoltraClientEvent } from '../../sdk/types';
import { createFrame } from '../../voltra/models/telemetry/frame';
import { MovementPhase } from '../../voltra/protocol/constants';

const CLIENT = { settings: DEFAULT_SETTINGS };

const CONNECTED: VoltraDeviceState = {
  connectionState: 'connected',
  isConnected: true,
  isReconnecting: false,
  recordingState: 'idle',
  isRecording: false,
  settings: DEFAULT_SETTINGS,
  currentFrame: null,
  error: null,
};

/** Fold a sequence of events over a starting state. */
function fold(start: VoltraDeviceState, events: VoltraClientEvent[]): VoltraDeviceState {
  return events.reduce((s, e) => reduceVoltraDeviceEvent(s, e, CLIENT), start);
}

describe('reduceVoltraDeviceEvent', () => {
  it('surfaces isReconnecting=true during an auto-reconnect and false after it completes', () => {
    // Involuntary reconnect sequence (post SDK-01.09):
    // connected -> disconnected -> reconnecting -> connecting -> authenticating -> connected
    let s = reduceVoltraDeviceEvent(
      CONNECTED,
      { type: 'connectionStateChanged', state: 'disconnected' },
      CLIENT
    );
    expect(s.isReconnecting).toBe(false);

    s = reduceVoltraDeviceEvent(s, { type: 'reconnecting', attempt: 1, maxAttempts: 3 }, CLIENT);
    expect(s.isReconnecting).toBe(true);

    // Stays true while the reconnect's connect() cycles through states.
    s = fold(s, [
      { type: 'connectionStateChanged', state: 'connecting' },
      { type: 'connectionStateChanged', state: 'authenticating' },
    ]);
    expect(s.isReconnecting).toBe(true);
    expect(s.isConnected).toBe(false);

    // Reconnect succeeds.
    s = fold(s, [
      { type: 'connected', deviceId: 'd1', deviceName: 'VTR-1' },
      { type: 'connectionStateChanged', state: 'connected' },
    ]);
    expect(s.isReconnecting).toBe(false);
    expect(s.isConnected).toBe(true);
    expect(s.connectionState).toBe('connected');
  });

  it('preserves error across a disconnect (does not wipe it)', () => {
    const err = new Error('link died mid-set');
    const withError = reduceVoltraDeviceEvent(CONNECTED, { type: 'error', error: err }, CLIENT);
    expect(withError.error).toBe(err);

    const afterDisconnect = reduceVoltraDeviceEvent(
      withError,
      { type: 'disconnected', deviceId: 'd1' },
      CLIENT
    );
    expect(afterDisconnect.error).toBe(err); // preserved
    expect(afterDisconnect.connectionState).toBe('disconnected');
    expect(afterDisconnect.isConnected).toBe(false);
    expect(afterDisconnect.isReconnecting).toBe(false);
    expect(afterDisconnect.currentFrame).toBeNull();
  });

  it('clears isReconnecting and error on a fresh connect', () => {
    const reconnecting = fold(CONNECTED, [
      { type: 'error', error: new Error('boom') },
      { type: 'reconnecting', attempt: 2, maxAttempts: 3 },
    ]);
    expect(reconnecting.isReconnecting).toBe(true);
    expect(reconnecting.error).not.toBeNull();

    const connected = reduceVoltraDeviceEvent(
      reconnecting,
      { type: 'connected', deviceId: 'd1', deviceName: 'VTR-1' },
      CLIENT
    );
    expect(connected.isReconnecting).toBe(false);
    expect(connected.error).toBeNull();
    expect(connected.settings).toBe(DEFAULT_SETTINGS);
  });

  it('updates connection/recording/frame without touching unrelated fields', () => {
    const frame = createFrame(1, MovementPhase.CONCENTRIC, 100, 200, 50);
    const s = fold(CONNECTED, [
      { type: 'recordingStateChanged', state: 'active' },
      { type: 'frame', frame },
    ]);
    expect(s.recordingState).toBe('active');
    expect(s.isRecording).toBe(true);
    expect(s.currentFrame).toBe(frame);
    expect(s.isConnected).toBe(true); // untouched
  });
});
