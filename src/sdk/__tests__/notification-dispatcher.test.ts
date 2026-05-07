import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNotificationHandler, type NotificationCallbacks } from '../notification-dispatcher';
import { TrainingMode, VendorSchemaVersion } from '../../voltra/protocol/constants';
import type { TelemetryFrame } from '../../voltra/models/telemetry';
import type { DeviceSettings, StateDumpEvent } from '../../voltra/protocol/types';
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
    onFrame: vi.fn(),
    onModeConfirmed: vi.fn(),
    onSettingsUpdate: vi.fn(),
    onStateDump: vi.fn(),
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
    expect(callbacks.onStateDump).not.toHaveBeenCalled();
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
    expect(callbacks.onStateDump).not.toHaveBeenCalled();
    expect(callbacks.onBatteryUpdate).not.toHaveBeenCalled();
    expect(callbacks.onPerRep).not.toHaveBeenCalled();
    expect(callbacks.onSummary).not.toHaveBeenCalled();
    expect(callbacks.onPreSummary).not.toHaveBeenCalled();
    expect(callbacks.onInProgress).not.toHaveBeenCalled();
  });

  it('dispatches onStateDump for cmd=0x07 state-dump frames', () => {
    // Synthesize a state-dump payload mirroring the cmd=0x07 (aa 80 25)
    // envelope contract documented in StateDumpEvent: chains-active flag at
    // offset 0, fitness-assist toggle at offset 1, chain target tenths at
    // offset 3 (uint16 LE). Raw `assistMode = 8` is the asymmetric idle
    // sentinel — consumers MUST receive it unmodified so they can apply
    // the off-when-not-1 rule themselves.
    const event: StateDumpEvent = {
      chainsActive: 1,
      assistMode: 8, // idle; not 0 — see voltra-private A10/A11 research notes
      chainTargetTenths: 250,
      raw: new Uint8Array(37),
    };
    mockDecode.mockReturnValue({ type: 'state_dump', event });

    handler(dummyData);

    expect(callbacks.onStateDump).toHaveBeenCalledOnce();
    expect(callbacks.onStateDump).toHaveBeenCalledWith(event);
    // Make sure we didn't accidentally fan out to the legacy settings
    // listener — assistMode/chainsActive lives only on stateDump.
    expect(callbacks.onSettingsUpdate).not.toHaveBeenCalled();
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
});
