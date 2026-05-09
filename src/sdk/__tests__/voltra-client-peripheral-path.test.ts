/**
 * Phase 0 (2026-05-08) — VoltraClient peripheral-path tests.
 *
 * Verify that constructing `VoltraClient` with a `Peripheral` (Phase 0
 * path) yields the same observable behavior as constructing with a
 * legacy `BLEAdapter`. The peripheral is already dialed, so
 * `client.connect(device)` should run auth + init only and skip the
 * BLE-level dial.
 *
 * Also covers `client.unsafeDiagnostics()` — the narrowed diagnostic
 * accessor that replaces `client.getAdapter().write(...)` for byte-pipe
 * tooling (mcp's `device.send_raw`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LegacyAdapterHost } from '../../bluetooth/adapters/legacy-shim';
import { MockBLEAdapter } from '../../bluetooth/adapters/mock';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';

const device: Device = { id: 'mock-voltra-001', name: 'VTR-MOCK01', rssi: -50 };

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

describe('VoltraClient — peripheral-path (Phase 0)', () => {
  let host: LegacyAdapterHost;
  let client: VoltraClient;

  beforeEach(() => {
    vi.useFakeTimers();
    host = new LegacyAdapterHost(() => new MockBLEAdapter({ connectDelayMs: 0, scanDelayMs: 0 }));
  });

  afterEach(async () => {
    client?.dispose();
    await host.dispose();
    vi.useRealTimers();
  });

  it('constructs with a Peripheral and connects via auth + init only', async () => {
    const [discovery] = await flushAndAwait(host.scan({ timeout: 50 }));
    const peripheral = await flushAndAwait(host.dial(discovery));
    expect(peripheral.status).toBe('connected');

    client = new VoltraClient({ peripheral });
    await flushAndAwait(client.connect(device));

    expect(client.isConnected).toBe(true);
    expect(client.connectedDeviceId).toBe(device.id);
  });

  it('throws when both adapter and peripheral are supplied', () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    expect(
      () =>
        new VoltraClient({
          adapter,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          peripheral: {} as any,
        })
    ).toThrow(/`adapter` OR `peripheral`/);
  });

  it('client.scan() throws when constructed with a peripheral', async () => {
    const [discovery] = await flushAndAwait(host.scan({ timeout: 50 }));
    const peripheral = await flushAndAwait(host.dial(discovery));
    client = new VoltraClient({ peripheral });
    await expect(client.scan({ timeout: 10 })).rejects.toThrow(/not supported/i);
  });

  it('client.dispose() releases peripheral-bridge subscriptions', async () => {
    const [discovery] = await flushAndAwait(host.scan({ timeout: 50 }));
    const peripheral = await flushAndAwait(host.dial(discovery));
    client = new VoltraClient({ peripheral });
    await flushAndAwait(client.connect(device));
    expect(() => client.dispose()).not.toThrow();
  });
});

describe('VoltraClient.unsafeDiagnostics()', () => {
  let adapter: MockBLEAdapter;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('returns null when the client has no adapter', () => {
    const empty = new VoltraClient();
    expect(empty.unsafeDiagnostics()).toBeNull();
    empty.dispose();
  });

  it('write() forwards bytes to the underlying adapter', async () => {
    const diag = client.unsafeDiagnostics();
    expect(diag).not.toBeNull();

    const writeSpy = vi.spyOn(adapter, 'write');
    const bytes = new Uint8Array([0x01, 0x02, 0x03]);
    await diag!.write(bytes);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0][0]).toEqual(bytes);
  });

  it('onResponse() subscribes to inbound notifications and returns an unsubscribe', () => {
    const diag = client.unsafeDiagnostics();
    const received: Uint8Array[] = [];
    const unsub = diag!.onResponse((data) => received.push(data));
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('flips the client to disconnected on write failure', async () => {
    const diag = client.unsafeDiagnostics();
    adapter.simulateWriteFailure(new Error('Write failed (simulated)'));

    await expect(diag!.write(new Uint8Array([0xff]))).rejects.toThrow(/functionally dead/);
    expect(client.isConnected).toBe(false);
  });
});
