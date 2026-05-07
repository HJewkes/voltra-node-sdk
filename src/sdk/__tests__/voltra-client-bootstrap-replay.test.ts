/**
 * Tests for VoltraClient 0.6.2 additions:
 *   - `onRawFrame` listener fires for every inbound notification, including
 *     unknowns
 *   - `onSettingsUpdate` replays the most recent cascade for late-attaching
 *     listeners (bootstrap-timing-window fix)
 *
 * The test pattern mocks the decoder so we don't need to construct
 * realistic settings-cascade bytes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { TrainingMode } from '../../voltra/protocol/constants';
import type { DeviceSettings } from '../../voltra/protocol/types';

vi.mock('../../voltra/protocol/telemetry-decoder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../voltra/protocol/telemetry-decoder')>();
  return {
    ...actual,
    decodeNotification: vi.fn(),
  };
});

import { decodeNotification } from '../../voltra/protocol/telemetry-decoder';
const mockDecode = vi.mocked(decodeNotification);

class RecordingAdapter extends BaseBLEAdapter {
  async scan(_timeout: number): Promise<Device[]> {
    return [];
  }
  async connect(_deviceId: string): Promise<void> {
    this.setConnectionState('connecting');
    this.setConnectionState('connected');
  }
  async disconnect(): Promise<void> {
    this.setConnectionState('disconnected');
  }
  async write(_data: Uint8Array): Promise<void> {}
  inject(data: Uint8Array): void {
    this.emitNotification(data);
  }
}

const device: Device = { id: 'device-x', name: 'VTR-XYZXYZ', rssi: -55 };

async function flushAndAwait<T>(promise: Promise<T>): Promise<T> {
  while (true) {
    const settled = await Promise.race([
      promise.then((value) => ({ done: true as const, value })),
      Promise.resolve().then(() => ({ done: false as const })),
    ]);
    if (settled.done) {
      return settled.value;
    }
    await vi.advanceTimersByTimeAsync(50);
  }
}

describe('VoltraClient — onRawFrame (0.6.2)', () => {
  let adapter: RecordingAdapter;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    adapter = new RecordingAdapter();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('fires onRawFrame for every inbound notification', () => {
    mockDecode.mockReturnValue({ type: 'unknown', data: new Uint8Array(0) });
    const listener = vi.fn();
    client.onRawFrame(listener);

    const data1 = new Uint8Array([0x01, 0x02, 0x03]);
    const data2 = new Uint8Array([0xff, 0xee]);
    adapter.inject(data1);
    adapter.inject(data2);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, data1);
    expect(listener).toHaveBeenNthCalledWith(2, data2);
  });

  it('fires onRawFrame even when decoder returns unknown', () => {
    mockDecode.mockReturnValue({ type: 'unknown', data: new Uint8Array(0) });
    const listener = vi.fn();
    client.onRawFrame(listener);

    const data = new Uint8Array([0x55, 0x10, 0x04]);
    adapter.inject(data);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(data);
  });

  it('returns an unsubscribe function', () => {
    mockDecode.mockReturnValue({ type: 'unknown', data: new Uint8Array(0) });
    const listener = vi.fn();
    const unsubscribe = client.onRawFrame(listener);

    adapter.inject(new Uint8Array([0x01]));
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    adapter.inject(new Uint8Array([0x02]));
    expect(listener).toHaveBeenCalledOnce(); // not called a second time
  });

  it('clears the listener set on dispose', () => {
    mockDecode.mockReturnValue({ type: 'unknown', data: new Uint8Array(0) });
    const listener = vi.fn();
    client.onRawFrame(listener);

    client.dispose();
    // After dispose, even if a stale notification arrives, listener must
    // not fire. (Adapter is already disconnected by dispose, but inject is
    // a test hook so it still calls through.)
    expect(() => adapter.inject(new Uint8Array([0x01]))).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('VoltraClient — onSettingsUpdate bootstrap replay (0.6.2)', () => {
  let adapter: RecordingAdapter;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    adapter = new RecordingAdapter();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('replays the most recent settings cascade to a late-attaching listener', () => {
    const settings: DeviceSettings = {
      baseWeight: 25,
      chains: 0,
      eccentric: 0,
      trainingMode: TrainingMode.Damper,
    };
    mockDecode.mockReturnValue({ type: 'settings_update', settings });

    // Bootstrap settings arrive BEFORE the consumer attaches.
    adapter.inject(new Uint8Array([0xaa, 0xbb]));

    // Consumer attaches AFTER bootstrap — must still see the cascade.
    const listener = vi.fn();
    client.onSettingsUpdate(listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(settings);
  });

  it('replays the LATEST cascade if multiple arrived pre-attach', () => {
    const first: DeviceSettings = { baseWeight: 20, chains: 0, eccentric: 0, trainingMode: TrainingMode.Idle };
    const second: DeviceSettings = { baseWeight: 30, chains: 5, eccentric: 0, trainingMode: TrainingMode.WeightTraining };

    mockDecode.mockReturnValueOnce({ type: 'settings_update', settings: first });
    adapter.inject(new Uint8Array([0x01]));
    mockDecode.mockReturnValueOnce({ type: 'settings_update', settings: second });
    adapter.inject(new Uint8Array([0x02]));

    const listener = vi.fn();
    client.onSettingsUpdate(listener);

    // Only the LATEST cached cascade replays.
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(second);
  });

  it('replays only once per attach (subsequent live cascades fire normally)', () => {
    const first: DeviceSettings = { baseWeight: 20, chains: 0, eccentric: 0, trainingMode: TrainingMode.Idle };
    const second: DeviceSettings = { baseWeight: 25, chains: 0, eccentric: 0, trainingMode: TrainingMode.Damper };

    mockDecode.mockReturnValueOnce({ type: 'settings_update', settings: first });
    adapter.inject(new Uint8Array([0x01]));

    const listener = vi.fn();
    client.onSettingsUpdate(listener);
    expect(listener).toHaveBeenCalledTimes(1); // replay

    mockDecode.mockReturnValueOnce({ type: 'settings_update', settings: second });
    adapter.inject(new Uint8Array([0x02]));
    expect(listener).toHaveBeenCalledTimes(2); // live event
    expect(listener).toHaveBeenLastCalledWith(second);
  });

  it('does NOT replay if no cascade has arrived yet', () => {
    const listener = vi.fn();
    client.onSettingsUpdate(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it('clears the replay cache on disconnect', async () => {
    const settings: DeviceSettings = { baseWeight: 25, chains: 0, eccentric: 0, trainingMode: TrainingMode.Damper };
    mockDecode.mockReturnValue({ type: 'settings_update', settings });

    adapter.inject(new Uint8Array([0x01]));
    await flushAndAwait(client.disconnect());
    await flushAndAwait(client.connect(device));

    // After reconnect, no cached cascade — late listener should not see
    // stale data from the previous connection.
    const listener = vi.fn();
    client.onSettingsUpdate(listener);
    expect(listener).not.toHaveBeenCalled();
  });
});
