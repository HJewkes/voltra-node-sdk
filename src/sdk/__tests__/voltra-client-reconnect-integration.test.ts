/**
 * SDK-01.09 integration regression — involuntary auto-reconnect reaches
 * 'connected' through the REAL connect() path.
 *
 * The bug: on an unexpected disconnect with autoReconnect=true, the reconnect
 * branch called client.connect(lastDevice) without first resetting
 * _connectionState off 'connected'. connect()'s ALREADY_CONNECTED guard then
 * threw on every attempt, so the client fired 'reconnecting' N times and gave
 * up at 'disconnected' — never actually reconnecting.
 *
 * This exercises the real MockBLEAdapter connect()/auth/init path (NOT a
 * mocked reconnect callback, which is why the existing reconnect-handler unit
 * tests missed the bug). It FAILS on pre-fix main and PASSES with the fix.
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

describe('SDK-01.09 — involuntary auto-reconnect (real connect path)', () => {
  let adapter: MockBLEAdapter;
  let client: VoltraClient;
  let events: VoltraClientEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    client = new VoltraClient({
      adapter,
      autoReconnect: true,
      reconnectDelayMs: 20,
      maxReconnectAttempts: 3,
    });
    events = [];
    client.subscribe((e) => events.push(e));
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('reconnects to connected after an unexpected disconnect', async () => {
    await flushAndAwait(client.connect(device));
    expect(client.connectionState).toBe('connected');
    events.length = 0;

    // Adapter-level drop (gattserverdisconnected analog) — not via disconnect().
    adapter.simulateUnexpectedDisconnect();

    // Drive the reconnect: attemptReconnect awaits reconnectDelayMs (20ms)
    // then runs the REAL connect() → adapter.connect + authenticate
    // (delay AUTH_TIMEOUT_MS = 3000ms) + initialize (init-command delays).
    // Advance generously past that total, stopping as soon as we reconnect.
    for (let i = 0; i < 200 && client.connectionState !== 'connected'; i++) {
      await vi.advanceTimersByTimeAsync(50);
    }

    // A reconnect attempt was announced...
    expect(events.some((e) => e.type === 'reconnecting')).toBe(true);
    // ...and it actually succeeded through the real connect() path.
    expect(client.connectionState).toBe('connected');
    expect(client.isConnected).toBe(true);
    expect(client.isReconnecting).toBe(false);
    expect(events.some((e) => e.type === 'connected')).toBe(true);
  });
});
