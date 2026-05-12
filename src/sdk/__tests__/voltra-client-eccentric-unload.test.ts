/**
 * Unit tests for the eccentric-overload rename + unloadDevice primitive.
 *
 * - setEccentric(overloadLbs) writes the expected protocol bytes (rename is
 *   docstring-only at the function-signature level; behavior is unchanged).
 * - unloadDevice() emits the mode-bounce sequence (Damper → WeightTraining)
 *   in order, with the inter-frame delay observed.
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

describe('VoltraClient — unloadDevice (mode-bounce)', () => {
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

  it('emits the Damper → WeightTraining mode-bounce sequence in order', async () => {
    const damperBytes = hexToBytes(protocol.commands.modes.damper);
    const wtBytes = hexToBytes(protocol.commands.modes.weightTraining);

    const promise = client.unloadDevice(0);
    await flushAndAwait(promise);

    const damperIdx = findWriteIndex(adapter, damperBytes);
    const wtIdx = findWriteIndex(adapter, wtBytes);

    expect(damperIdx).toBeGreaterThanOrEqual(0);
    expect(wtIdx).toBeGreaterThanOrEqual(0);
    expect(damperIdx).toBeLessThan(wtIdx);
  });

  it('honors the interFrameDelayMs parameter between writes', async () => {
    const damperBytes = hexToBytes(protocol.commands.modes.damper);
    const wtBytes = hexToBytes(protocol.commands.modes.weightTraining);

    // Start the unload — should write Damper immediately, then wait, then WT.
    const promise = client.unloadDevice(500);

    // Let the first microtask resolve so the first write lands.
    await Promise.resolve();
    await Promise.resolve();

    const damperIdx0 = findWriteIndex(adapter, damperBytes);
    const wtIdx0 = findWriteIndex(adapter, wtBytes);
    expect(damperIdx0).toBeGreaterThanOrEqual(0);
    // WT write should NOT have happened yet — still in the delay window.
    expect(wtIdx0).toBe(-1);

    // Advance past the delay; the WT write should now happen.
    await flushAndAwait(promise);
    const wtIdx1 = findWriteIndex(adapter, wtBytes);
    expect(wtIdx1).toBeGreaterThanOrEqual(0);
  });

  it('throws NotConnectedError when the client is not connected', async () => {
    const stand = new VoltraClient({ adapter: new RecordingAdapter() });
    await expect(stand.unloadDevice()).rejects.toBeInstanceOf(NotConnectedError);
  });
});
