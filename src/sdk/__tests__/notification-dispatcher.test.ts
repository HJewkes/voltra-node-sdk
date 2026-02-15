import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNotificationHandler, type NotificationCallbacks } from '../notification-dispatcher';
import { TrainingMode } from '../../voltra/protocol/constants';
import type { TelemetryFrame } from '../../voltra/models/telemetry';
import type { DeviceSettings } from '../../voltra/protocol/types';

// Mock the decoder so we can control exactly what DecodeResult comes back
vi.mock('../../voltra/protocol/telemetry-decoder', () => ({
  decodeNotification: vi.fn(),
}));

import { decodeNotification } from '../../voltra/protocol/telemetry-decoder';
const mockDecode = vi.mocked(decodeNotification);

function makeCallbacks(): NotificationCallbacks & {
  [K in keyof NotificationCallbacks]: ReturnType<typeof vi.fn>;
} {
  return {
    onFrame: vi.fn(),
    onRepBoundary: vi.fn(),
    onSetBoundary: vi.fn(),
    onModeConfirmed: vi.fn(),
    onSettingsUpdate: vi.fn(),
    onBatteryUpdate: vi.fn(),
  };
}

describe('notification-dispatcher', () => {
  let callbacks: ReturnType<typeof makeCallbacks>;
  let handler: (data: Uint8Array) => void;
  const dummyData = new Uint8Array([0]);

  beforeEach(() => {
    vi.clearAllMocks();
    callbacks = makeCallbacks();
    handler = createNotificationHandler(callbacks);
  });

  it('dispatches onFrame for telemetry frames', () => {
    const frame: TelemetryFrame = {
      sequence: 1,
      phase: 0,
      position: 100,
      force: 50,
      velocity: 200,
      timestamp: Date.now(),
    };
    mockDecode.mockReturnValue({ type: 'frame', frame });

    handler(dummyData);

    expect(callbacks.onFrame).toHaveBeenCalledOnce();
    expect(callbacks.onFrame).toHaveBeenCalledWith(frame);
    expect(callbacks.onRepBoundary).not.toHaveBeenCalled();
  });

  it('dispatches onRepBoundary for rep summaries', () => {
    mockDecode.mockReturnValue({ type: 'rep_boundary' });

    handler(dummyData);

    expect(callbacks.onRepBoundary).toHaveBeenCalledOnce();
    expect(callbacks.onFrame).not.toHaveBeenCalled();
  });

  it('dispatches onSetBoundary for set summaries', () => {
    mockDecode.mockReturnValue({ type: 'set_boundary' });

    handler(dummyData);

    expect(callbacks.onSetBoundary).toHaveBeenCalledOnce();
  });

  it('dispatches onModeConfirmed with TrainingMode', () => {
    mockDecode.mockReturnValue({
      type: 'mode_confirmation',
      mode: TrainingMode.WeightTraining,
    });

    handler(dummyData);

    expect(callbacks.onModeConfirmed).toHaveBeenCalledOnce();
    expect(callbacks.onModeConfirmed).toHaveBeenCalledWith(TrainingMode.WeightTraining);
  });

  it('dispatches onSettingsUpdate with DeviceSettings', () => {
    const settings: DeviceSettings = {
      baseWeight: 50,
      chains: 10,
      trainingMode: TrainingMode.Rowing,
    };
    mockDecode.mockReturnValue({ type: 'settings_update', settings });

    handler(dummyData);

    expect(callbacks.onSettingsUpdate).toHaveBeenCalledOnce();
    expect(callbacks.onSettingsUpdate).toHaveBeenCalledWith(settings);
  });

  it('dispatches onBatteryUpdate for device status', () => {
    mockDecode.mockReturnValue({ type: 'device_status', battery: 85 });

    handler(dummyData);

    expect(callbacks.onBatteryUpdate).toHaveBeenCalledOnce();
    expect(callbacks.onBatteryUpdate).toHaveBeenCalledWith(85);
  });

  it('ignores unknown notification types', () => {
    mockDecode.mockReturnValue({ type: 'unknown', data: dummyData });

    handler(dummyData);

    expect(callbacks.onFrame).not.toHaveBeenCalled();
    expect(callbacks.onRepBoundary).not.toHaveBeenCalled();
    expect(callbacks.onSetBoundary).not.toHaveBeenCalled();
    expect(callbacks.onModeConfirmed).not.toHaveBeenCalled();
    expect(callbacks.onSettingsUpdate).not.toHaveBeenCalled();
    expect(callbacks.onBatteryUpdate).not.toHaveBeenCalled();
  });

  it('ignores null decode results', () => {
    mockDecode.mockReturnValue(null);

    handler(dummyData);

    expect(callbacks.onFrame).not.toHaveBeenCalled();
    expect(callbacks.onRepBoundary).not.toHaveBeenCalled();
    expect(callbacks.onSetBoundary).not.toHaveBeenCalled();
    expect(callbacks.onModeConfirmed).not.toHaveBeenCalled();
    expect(callbacks.onSettingsUpdate).not.toHaveBeenCalled();
    expect(callbacks.onBatteryUpdate).not.toHaveBeenCalled();
  });
});
