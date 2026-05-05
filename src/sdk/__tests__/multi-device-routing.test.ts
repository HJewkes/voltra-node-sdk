/**
 * Regression test for the multi-device routing bug.
 *
 * Before the fix, VoltraManager.connect reused a singleton scanAdapter for
 * every client connection. Adapters hold singleton device/server/writeChar
 * fields that get clobbered on each connectToDevice, so writes (setWeight,
 * setMode, etc.) from any VoltraClient would land on the most-recently-
 * connected peripheral.
 *
 * The fix gives each client its own adapter instance. This test verifies
 * that writes routed through clientA reach adapterA only and vice versa.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraManager } from '../voltra-manager';
import { getWeightCommand } from '../../voltra/protocol/commands';

/**
 * Minimal adapter stub that records writes to a per-instance array.
 * Connect/auth/init succeed instantly so we can drive the manager
 * end-to-end without timer fakery.
 */
class RecordingAdapter extends BaseBLEAdapter {
  readonly writes: Uint8Array[] = [];
  private knownDevices: Device[];

  constructor(devices: Device[]) {
    super();
    this.knownDevices = devices;
  }

  async scan(_timeout: number): Promise<Device[]> {
    return this.knownDevices;
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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function lastWriteMatches(adapter: RecordingAdapter, expected: Uint8Array): boolean {
  const last = adapter.writes[adapter.writes.length - 1];
  return last !== undefined && bytesEqual(last, expected);
}

describe('VoltraManager multi-device routing', () => {
  let manager: VoltraManager;

  const deviceA: Device = { id: 'device-a', name: 'VTR-AAAAAA', rssi: -50 };
  const deviceB: Device = { id: 'device-b', name: 'VTR-BBBBBB', rssi: -60 };

  /**
   * Awaits a promise while flushing any pending fake timers.
   * client.connect resolves only after auth + init delays elapse.
   */
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

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new VoltraManager({
      platform: 'node',
      adapterFactory: () => new RecordingAdapter([deviceA, deviceB]),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives each client its own adapter instance', async () => {
    const clientA = await flushAndAwait(manager.connect(deviceA));
    const clientB = await flushAndAwait(manager.connect(deviceB));

    expect(clientA.getAdapter()).not.toBe(clientB.getAdapter());
    expect(clientA.getAdapter()).toBeInstanceOf(RecordingAdapter);
    expect(clientB.getAdapter()).toBeInstanceOf(RecordingAdapter);
  });

  it('routes setWeight to the adapter owned by the issuing client', async () => {
    const clientA = await flushAndAwait(manager.connect(deviceA));
    const clientB = await flushAndAwait(manager.connect(deviceB));

    const adapterA = clientA.getAdapter() as RecordingAdapter;
    const adapterB = clientB.getAdapter() as RecordingAdapter;

    const weightA = getWeightCommand(30)!;
    const weightB = getWeightCommand(40)!;

    await clientA.setWeight(30);
    await clientB.setWeight(40);

    expect(lastWriteMatches(adapterA, weightA)).toBe(true);
    expect(lastWriteMatches(adapterB, weightB)).toBe(true);
    expect(clientA.settings.weight).toBe(30);
    expect(clientB.settings.weight).toBe(40);

    // Subsequent write to B must not bleed into A.
    const weightB2 = getWeightCommand(50)!;
    await clientB.setWeight(50);

    expect(lastWriteMatches(adapterA, weightA)).toBe(true);
    expect(lastWriteMatches(adapterB, weightB2)).toBe(true);
    expect(clientA.settings.weight).toBe(30);
    expect(clientB.settings.weight).toBe(50);
  });

  it('returns the existing client when connect is called twice for the same device', async () => {
    const clientA1 = await flushAndAwait(manager.connect(deviceA));
    const clientA2 = await flushAndAwait(manager.connect(deviceA));

    expect(clientA2).toBe(clientA1);
    expect(manager.connectedCount).toBe(1);
  });

  it('disconnects only the targeted client', async () => {
    const clientA = await flushAndAwait(manager.connect(deviceA));
    const clientB = await flushAndAwait(manager.connect(deviceB));

    await manager.disconnect(deviceA.id);

    expect(manager.isConnected(deviceA.id)).toBe(false);
    expect(manager.isConnected(deviceB.id)).toBe(true);
    expect(clientA.isConnected).toBe(false);
    expect(clientB.isConnected).toBe(true);

    // clientB can still issue writes after clientA is gone.
    const adapterB = clientB.getAdapter() as RecordingAdapter;
    const weightB = getWeightCommand(60)!;
    await clientB.setWeight(60);
    expect(lastWriteMatches(adapterB, weightB)).toBe(true);
  });
});
