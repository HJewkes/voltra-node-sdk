/**
 * VW-572: the mock device reports weight and chains writes back, as a real
 * device does, so a consumer sees the new value confirmed by the device.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockBLEAdapter } from '../../bluetooth/adapters/mock';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import type { DeviceSettings } from '../../voltra/protocol/types';

const device: Device = { id: 'mock-voltra-001', name: 'VTR-MOCK01', rssi: -50 };

async function flushAndAwait<T>(promise: Promise<T>): Promise<T> {
  while (true) {
    const settled = await Promise.race([
      promise.then((value) => ({ done: true as const, value })),
      Promise.resolve().then(() => ({ done: false as const })),
    ]);
    if (settled.done) return settled.value;
    await vi.advanceTimersByTimeAsync(50);
  }
}

describe('MockBLEAdapter settings echo seen through VoltraClient', () => {
  let adapter: MockBLEAdapter;
  let client: VoltraClient;
  let updates: DeviceSettings[];

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new MockBLEAdapter({ connectDelayMs: 0, weight: 50 });
    client = new VoltraClient({ adapter, autoReconnect: false });
    await flushAndAwait(client.connect(device));
    updates = [];
    client.onSettingsUpdate((settings) => updates.push(settings));
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('reports a weight write back as the confirmed weight', async () => {
    await client.setWeight(80);
    await vi.advanceTimersByTimeAsync(0);

    expect(updates).toContainEqual(expect.objectContaining({ baseWeight: 80 }));
    expect(client.confirmedSettings.weight).toBe(80);
    expect(client.requestedSettings.weight).toBeUndefined();
    expect(client.settings.weight).toBe(80);
  });

  it('reports a chains write back as the confirmed chains', async () => {
    await client.setChains(25);
    await vi.advanceTimersByTimeAsync(0);

    expect(updates).toContainEqual(expect.objectContaining({ chains: 25 }));
    expect(client.confirmedSettings.chains).toBe(25);
    expect(client.requestedSettings.chains).toBeUndefined();
  });

  it('answers a later core-state read with the weight last written', async () => {
    await client.setWeight(95);
    await vi.advanceTimersByTimeAsync(0);
    await flushAndAwait(client.disconnect());

    await flushAndAwait(client.connect(device));

    expect(client.confirmedSettings.weight).toBe(95);
  });

  it('does not echo a setting once the link is gone', async () => {
    await client.setWeight(60);
    adapter.simulateLinkLoss();
    await vi.advanceTimersByTimeAsync(0);

    expect(updates).not.toContainEqual(expect.objectContaining({ baseWeight: 60 }));
    expect(client.requestedSettings.weight).toBe(60);
  });
});
