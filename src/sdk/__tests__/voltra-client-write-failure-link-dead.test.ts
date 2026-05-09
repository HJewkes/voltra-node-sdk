/**
 * Bug 30 follow-up — write-failure with link-alive flips state to disconnected.
 *
 * The 0.7.2 fix added `isLinkAlive()` to the BLE adapter interface and made
 * `ensureConnected()` consult it before every setter call. That catches the
 * `gattserverdisconnected` race where the writeChar handle is null but the
 * tracked connection state still says 'connected'.
 *
 * The fix is incomplete: the writeChar can also be intact (so `isLinkAlive()`
 * still says alive) while the underlying GATT write pipe is jammed —
 * supervision-timeout-adjacent or MTU-window collapse. In that state the
 * adapter throws `Write failed`, the SDK previously surfaced an opaque
 * `CommandError`, and consumers retried the same setter (which fails
 * identically). Observed on VTR-097082 2026-05-07T16-11-15 across three
 * setters in a row before disconnect/reconnect resolved cleanly.
 *
 * Per `feedback_ble_write_fail_reconnect_not_retry`, the SDK must:
 *   1. throw `ConnectionError(CONNECTION_LOST)` (not a CommandError),
 *   2. flip `connectionState` to 'disconnected' so the next setter call
 *      bails out via `ensureConnected()`,
 *   3. emit a 'disconnected' event so consumers see a unified disconnect
 *      signal regardless of whether the link died pre- or mid-write.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockBLEAdapter } from '../../bluetooth/adapters/mock';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { ConnectionError, ErrorCode } from '../../errors';
import type { VoltraClientEvent } from '../types';

const device: Device = { id: 'mock-voltra-002', name: 'VTR-MOCK02', rssi: -50 };

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

describe('Bug 30 follow-up — write-failure with link-alive flips state to disconnected', () => {
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
    events.length = 0;
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('rejects setter calls with CONNECTION_LOST when the write pipe stalls but link reports alive', async () => {
    adapter.simulateWriteFailure(new Error('Write failed'));
    expect(adapter.isLinkAlive()).toBe(true);
    expect(client.connectionState).toBe('connected');

    let thrown: unknown;
    try {
      await client.setDamperLevel(2);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ConnectionError);
    expect((thrown as ConnectionError).code).toBe(ErrorCode.CONNECTION_LOST);
    expect((thrown as Error).message).toMatch(/link is functionally dead|reconnect required/i);
    expect((thrown as ConnectionError).cause?.message).toBe('Write failed');
  });

  it('flips connectionState to disconnected after the failed write', async () => {
    adapter.simulateWriteFailure();
    await expect(client.setDamperLevel(2)).rejects.toBeInstanceOf(ConnectionError);

    expect(client.connectionState).toBe('disconnected');
    expect(client.isConnected).toBe(false);
  });

  it('emits a disconnected event so consumers can react to the recovered state', async () => {
    adapter.simulateWriteFailure();

    await expect(client.setDamperLevel(2)).rejects.toBeInstanceOf(ConnectionError);

    const disconnectEvent = events.find((e) => e.type === 'disconnected');
    expect(disconnectEvent).toBeDefined();
    if (disconnectEvent && disconnectEvent.type === 'disconnected') {
      expect(disconnectEvent.deviceId).toBe(device.id);
    }
  });

  it('makes retrying the same setter impossible — second call short-circuits via ensureConnected', async () => {
    adapter.simulateWriteFailure();
    await expect(client.setDamperLevel(2)).rejects.toBeInstanceOf(ConnectionError);

    // The second call must NOT reach the adapter — it should bail at
    // ensureConnected() because connectionState is now 'disconnected'.
    // No further simulateWriteFailure was queued, so a successful write
    // would have decoded as a damper-level setter; this assertion proves
    // the call never made it past ensureConnected.
    let secondError: unknown;
    try {
      await client.setDamperLevel(3);
    } catch (e) {
      secondError = e;
    }

    expect(secondError).toBeDefined();
    // NotConnectedError extends VoltraSDKError; ConnectionError on the
    // first call is followed by NotConnectedError on the second since
    // _connectionState has already been flipped to 'disconnected'.
    expect((secondError as Error).name).toMatch(/NotConnectedError|ConnectionError/);
  });

  it('also flips on writeFrame failures from non-setter call sites (e.g. exitGuidedLoad)', async () => {
    adapter.simulateWriteFailure(new Error('Write failed'));

    let thrown: unknown;
    try {
      await client.exitGuidedLoad();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ConnectionError);
    expect((thrown as ConnectionError).code).toBe(ErrorCode.CONNECTION_LOST);
    expect(client.connectionState).toBe('disconnected');
  });
});
