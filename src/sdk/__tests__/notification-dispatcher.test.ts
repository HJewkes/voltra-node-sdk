import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNotificationHandler, type NotificationCallbacks } from '../notification-dispatcher';
import { TrainingMode, VendorSchemaVersion } from '../../voltra/protocol/constants';
import type { TelemetryFrame } from '../../voltra/models/telemetry';
import type { DeviceSettings } from '../../voltra/protocol/types';
import type { PerRepEvent, SummaryEvent, PreSummaryEvent, InProgressEvent } from '../types';

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
    onRawFrame: vi.fn(),
    onFrame: vi.fn(),
    onModeConfirmed: vi.fn(),
    onSettingsUpdate: vi.fn(),
    onBatteryUpdate: vi.fn(),
    onPerRep: vi.fn(),
    onSummary: vi.fn(),
    onPreSummary: vi.fn(),
    onInProgress: vi.fn(),
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
    expect(callbacks.onPerRep).not.toHaveBeenCalled();
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
    expect(callbacks.onModeConfirmed).not.toHaveBeenCalled();
    expect(callbacks.onSettingsUpdate).not.toHaveBeenCalled();
    expect(callbacks.onBatteryUpdate).not.toHaveBeenCalled();
    expect(callbacks.onPerRep).not.toHaveBeenCalled();
    expect(callbacks.onSummary).not.toHaveBeenCalled();
    expect(callbacks.onPreSummary).not.toHaveBeenCalled();
    expect(callbacks.onInProgress).not.toHaveBeenCalled();
  });

  it('ignores null decode results', () => {
    mockDecode.mockReturnValue(null);

    handler(dummyData);

    expect(callbacks.onFrame).not.toHaveBeenCalled();
    expect(callbacks.onModeConfirmed).not.toHaveBeenCalled();
    expect(callbacks.onSettingsUpdate).not.toHaveBeenCalled();
    expect(callbacks.onBatteryUpdate).not.toHaveBeenCalled();
    expect(callbacks.onPerRep).not.toHaveBeenCalled();
    expect(callbacks.onSummary).not.toHaveBeenCalled();
    expect(callbacks.onPreSummary).not.toHaveBeenCalled();
    expect(callbacks.onInProgress).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // Typed vendor-frame events (0.6.0+)
  // ===========================================================================

  it('dispatches onPerRep for perRep results', () => {
    const event: PerRepEvent = {
      phase: 'pull',
      frameCounter: 1,
      setCounter: 1,
      repCount: 1,
      targetWeightTenths: 500,
    };
    mockDecode.mockReturnValue({ type: 'perRep', event });

    handler(dummyData);

    expect(callbacks.onPerRep).toHaveBeenCalledOnce();
    expect(callbacks.onPerRep).toHaveBeenCalledWith(event);
  });

  it('dispatches onInProgress for inProgress results', () => {
    const event: InProgressEvent = {
      peakForceTenths: 1234,
      currentForceTenths: 800,
      velocityCmPerSec: 50,
      targetWeightTenths: 500,
      raw: new Uint8Array(79),
    };
    mockDecode.mockReturnValue({ type: 'inProgress', event });

    handler(dummyData);

    expect(callbacks.onInProgress).toHaveBeenCalledOnce();
    expect(callbacks.onInProgress).toHaveBeenCalledWith(event);
  });

  it('dispatches onSummary for summary results', () => {
    const event: SummaryEvent = {
      schemaVersion: VendorSchemaVersion.Weight,
      setCounter: 1,
      repCount: 5,
      raw: new Uint8Array(140),
    };
    mockDecode.mockReturnValue({ type: 'summary', event });

    handler(dummyData);

    expect(callbacks.onSummary).toHaveBeenCalledOnce();
    expect(callbacks.onSummary).toHaveBeenCalledWith(event);
  });

  it('dispatches onPreSummary for preSummary results', () => {
    const event: PreSummaryEvent = {
      schemaVersion: VendorSchemaVersion.Damper,
      targetWeightTenths: 0,
      repCount: 5,
      repDurationMs: 1234,
      raw: new Uint8Array(110),
    };
    mockDecode.mockReturnValue({ type: 'preSummary', event });

    handler(dummyData);

    expect(callbacks.onPreSummary).toHaveBeenCalledOnce();
    expect(callbacks.onPreSummary).toHaveBeenCalledWith(event);
  });

  // ===========================================================================
  // Raw-frame callback (0.6.2+)
  // ===========================================================================

  it('fires onRawFrame for every notification, before decode', () => {
    const frame: TelemetryFrame = {
      sequence: 1,
      timestamp: 100,
      phase: 1 as never,
      position: 0,
      velocity: 0,
      force: 0,
    };
    mockDecode.mockReturnValue({ type: 'frame', frame });

    handler(dummyData);

    expect(callbacks.onRawFrame).toHaveBeenCalledOnce();
    expect(callbacks.onRawFrame).toHaveBeenCalledWith(dummyData);
    // Typed callback also fires
    expect(callbacks.onFrame).toHaveBeenCalledOnce();
  });

  it('fires onRawFrame even when decoder returns unknown', () => {
    mockDecode.mockReturnValue({ type: 'unknown', data: dummyData });

    handler(dummyData);

    expect(callbacks.onRawFrame).toHaveBeenCalledOnce();
    expect(callbacks.onRawFrame).toHaveBeenCalledWith(dummyData);
    expect(callbacks.onFrame).not.toHaveBeenCalled();
  });

  it('fires onRawFrame even when decoder returns null', () => {
    mockDecode.mockReturnValue(null);

    handler(dummyData);

    expect(callbacks.onRawFrame).toHaveBeenCalledOnce();
    expect(callbacks.onRawFrame).toHaveBeenCalledWith(dummyData);
  });
});
