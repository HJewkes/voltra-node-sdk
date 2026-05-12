/**
 * Unit tests for the eccentric-overload rename + unloadDevice primitive.
 *
 * - setEccentric(overloadLbs) writes the expected protocol bytes (rename is
 *   docstring-only at the function-signature level; behavior is unchanged).
 * - unloadDevice() writes the Workout.STOP frame (canonical motor-disengage
 *   primitive, paired with Workout.GO used by startRecording).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { InvalidSettingError, NotConnectedError } from '../../errors';
import { hexToBytes } from '../../shared/utils';
import protocolData from '../../voltra/protocol/data/protocol-data.generated';
import type { ProtocolData } from '../../voltra/protocol/types';

const protocol = protocolData as ProtocolData;

class RecordingAdapter extends BaseBLEAdapter {
  readonly writes: Uint8Array[] = [];

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

  async write(data: Uint8Array): Promise<void> {
    this.writes.push(new Uint8Array(data));
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

function findWriteIndex(adapter: RecordingAdapter, expected: Uint8Array): number {
  for (let i = 0; i < adapter.writes.length; i++) {
    const w = adapter.writes[i];
    if (w.length === expected.length && w.every((b, j) => b === expected[j])) {
      return i;
    }
  }
  return -1;
}

describe('VoltraClient — setEccentric (overloadLbs rename)', () => {
  let adapter: RecordingAdapter;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new RecordingAdapter();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
    adapter.writes.length = 0;
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('writes the expected bytes for a valid eccentric overload value', async () => {
    // Pick a value known to exist in the protocol's eccentric table.
    const validValue = Number(Object.keys(protocol.commands.eccentric)[0]);
    await client.setEccentric(validValue);
    const expected = hexToBytes(protocol.commands.eccentric[String(validValue)]);
    expect(findWriteIndex(adapter, expected)).toBeGreaterThanOrEqual(0);
  });

  it('throws InvalidSettingError for an out-of-range value', async () => {
    await expect(client.setEccentric(9999)).rejects.toBeInstanceOf(InvalidSettingError);
  });

  it('throws NotConnectedError when the client is not connected', async () => {
    const stand = new VoltraClient({ adapter: new RecordingAdapter() });
    await expect(stand.setEccentric(0)).rejects.toBeInstanceOf(NotConnectedError);
  });
});

describe('VoltraClient — unloadDevice (Workout.STOP)', () => {
  let adapter: RecordingAdapter;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new RecordingAdapter();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
    adapter.writes.length = 0;
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('writes the Workout.STOP frame', async () => {
    const stopBytes = hexToBytes(protocol.commands.workout.stop);

    await flushAndAwait(client.unloadDevice());

    const stopIdx = findWriteIndex(adapter, stopBytes);
    expect(stopIdx).toBeGreaterThanOrEqual(0);
  });

  it('does not emit any mode-switch frames (no longer a mode-bounce)', async () => {
    const damperBytes = hexToBytes(protocol.commands.modes.damper);
    const wtBytes = hexToBytes(protocol.commands.modes.weightTraining);

    await flushAndAwait(client.unloadDevice());

    expect(findWriteIndex(adapter, damperBytes)).toBe(-1);
    expect(findWriteIndex(adapter, wtBytes)).toBe(-1);
  });

  it('throws NotConnectedError when the client is not connected', async () => {
    const stand = new VoltraClient({ adapter: new RecordingAdapter() });
    await expect(stand.unloadDevice()).rejects.toBeInstanceOf(NotConnectedError);
  });
});
