/**
 * Bug 30 regression — `ensureConnected()` consults adapter link liveness.
 *
 * Reproducer: `voltra-private/captures/sessions/2026-05-07T10-12-37/`.
 *
 * The state-split: `VoltraClient._connectionState` and the BLE adapter's
 * write-channel handle (Web/Node Bluetooth `writeChar`, native device
 * handle) are independent. `gattserverdisconnected` racing the connect
 * path (or any unexpected adapter-level disconnect with `autoReconnect=
 * false`) leaves the adapter with a null write channel while the client
 * still reports `connectionState='connected'`. Setter calls then fail
 * with the opaque adapter-layer "Not connected to device" error and the
 * client never reflects the disconnect.
 *
 * This test simulates that race using `MockBLEAdapter.simulateLinkLoss()`
 * and asserts that the next setter call:
 *   1. throws a `ConnectionError` with code `CONNECTION_LOST`,
 *   2. drives the client's `connectionState` back to `'disconnected'`,
 *   3. emits a `'disconnected'` event so downstream consumers can react.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockBLEAdapter } from '../../bluetooth/adapters/mock';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { ConnectionError, ErrorCode } from '../../errors';
import type { VoltraClientEvent } from '../types';

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

describe('Bug 30 — ensureConnected() detects adapter writeChar liveness loss', () => {
  let adapter: MockBLEAdapter;
  let client: VoltraClient;
  let events: VoltraClientEvent[];

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    client = new VoltraClient({ adapter, autoReconnect: false });
    events = [];
    client.subscribe((e) => events.push(e));
    await flushAndAwait(client.connect(device));
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('initial state — client is connected and link is alive', () => {
    expect(client.connectionState).toBe('connected');
    expect(adapter.isLinkAlive()).toBe(true);
  });

  it('rejects setter calls with ConnectionError after the link silently dies', async () => {
    // Simulate `gattserverdisconnected` racing setupDisconnectHandler:
    // adapter writeChar is gone, but VoltraClient still believes it's
    // 'connected' because the native disconnect callback never fired.
    adapter.simulateLinkLoss();
    expect(adapter.isLinkAlive()).toBe(false);
    expect(client.connectionState).toBe('connected'); // pre-call: stale 'connected'

    let thrown: unknown;
    try {
      await client.setDamperLevel(2);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ConnectionError);
    expect((thrown as ConnectionError).code).toBe(ErrorCode.CONNECTION_LOST);
    expect((thrown as Error).message).toMatch(/link lost|write channel/i);
  });

  it('drives connectionState back to disconnected after the failed setter call', async () => {
    adapter.simulateLinkLoss();
    await expect(client.setDamperLevel(2)).rejects.toBeInstanceOf(ConnectionError);

    expect(client.connectionState).toBe('disconnected');
    expect(client.isConnected).toBe(false);
  });

  it('emits a disconnected event so consumers can react to the recovered state', async () => {
    adapter.simulateLinkLoss();
    events.length = 0; // start fresh — focus on what fires from the setter call.

    await expect(client.setDamperLevel(2)).rejects.toBeInstanceOf(ConnectionError);

    const disconnectEvent = events.find((e) => e.type === 'disconnected');
    expect(disconnectEvent).toBeDefined();
    if (disconnectEvent && disconnectEvent.type === 'disconnected') {
      expect(disconnectEvent.deviceId).toBe(device.id);
    }
  });
});
