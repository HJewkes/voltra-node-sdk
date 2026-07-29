/**
 * Slot-routing regression — adapter-level unexpected disconnect propagates
 * to client connection state even when `autoReconnect=false`.
 *
 * Background:
 *   `sources/audits/ble-slot-routing-2026-05-08.md`
 *   `sources/audits/sdk-slot-routing-code-trace-2026-05-08.md`
 *
 * The "Fix C" case: previously `setupDisconnectMonitor` short-circuited with
 * `return null` when `options.autoReconnect === false`, so adapter-level
 * `gattserverdisconnected` events never reached the client. The client's
 * `_connectionState` stayed `'connected'` even though the adapter was dead,
 * which is the state-split that allowed cross-slot write delivery in the
 * MCP layer (slot was metadata, isConnected was lying).
 *
 * The fix wires the listener regardless of autoReconnect; only the reconnect
 * *attempts* are gated downstream in `handleUnexpectedDisconnect`. This
 * test asserts the always-on path: `MockBLEAdapter.simulateUnexpectedDisconnect()`
 * fires the adapter's connection-state change, the client observes it, and
 * its state + events reflect the disconnect.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockBLEAdapter } from '../../bluetooth/adapters/mock';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
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

describe('Fix C — disconnect monitor installs even with autoReconnect=false', () => {
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
    expect(client.connectionState).toBe('connected');
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('flips connectionState to disconnected when adapter disconnects unexpectedly', async () => {
    adapter.simulateUnexpectedDisconnect();

    // Allow the async handleUnexpectedDisconnect path to run.
    await flushAndAwait(Promise.resolve());

    expect(client.connectionState).toBe('disconnected');
    expect(client.isConnected).toBe(false);
  });

  it('emits a disconnected event when adapter disconnects unexpectedly', async () => {
    events.length = 0; // ignore connect events
    adapter.simulateUnexpectedDisconnect();
    await flushAndAwait(Promise.resolve());

    const disconnectEvent = events.find((e) => e.type === 'disconnected');
    expect(disconnectEvent).toBeDefined();
    // Note: in `handleUnexpectedDisconnect`, `cleanup()` runs before the
    // emit and clears `_connectedDeviceId`, so the event carries 'unknown'.
    // That's a pre-existing quirk of the client (see voltra-client.ts:1909-1911)
    // and is not what this regression is testing — the slot-routing fix is
    // about the event firing AT ALL when autoReconnect=false.
    if (disconnectEvent && disconnectEvent.type === 'disconnected') {
      expect(typeof disconnectEvent.deviceId).toBe('string');
    }
  });

  it('does NOT attempt reconnect when autoReconnect=false', async () => {
    events.length = 0;
    adapter.simulateUnexpectedDisconnect();
    await flushAndAwait(Promise.resolve());

    const reconnectingEvent = events.find((e) => e.type === 'reconnecting');
    expect(reconnectingEvent).toBeUndefined();
    expect(client.isReconnecting).toBe(false);
  });
});
