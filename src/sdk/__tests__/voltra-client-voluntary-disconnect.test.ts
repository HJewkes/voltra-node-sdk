/**
 * SDK-01.06 regression — voluntary `disconnect()` semantics.
 *
 * A voluntary `disconnect()` flips the adapter state, which routes back
 * through the always-on disconnect monitor into `handleUnexpectedDisconnect`.
 * Two bugs lived there:
 *
 *   #1 With `autoReconnect: true`, that path entered the reconnect branch and
 *      brought the just-disconnected device back up — `disconnect()` could not
 *      actually disconnect.
 *   #2 On the default path (`autoReconnect: false`) the monitor AND
 *      `disconnect()` both emitted `'disconnected'`, so consumers saw it twice.
 *
 * The fix makes `handleUnexpectedDisconnect` bail out when a voluntary
 * disconnect is in flight, so `disconnect()` solely owns the teardown. These
 * tests use exact-count / presence assertions the original suite lacked (it
 * only used `events.find`, which a double-emit passes).
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

describe('SDK-01.06 — voluntary disconnect()', () => {
  let adapter: MockBLEAdapter;
  let events: VoltraClientEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('#1 does NOT auto-reconnect when autoReconnect=true', async () => {
    adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const client = new VoltraClient({
      adapter,
      autoReconnect: true,
      reconnectDelayMs: 20,
      maxReconnectAttempts: 3,
    });
    client.subscribe((e) => events.push(e));

    await flushAndAwait(client.connect(device));
    events.length = 0;

    await flushAndAwait(client.disconnect());
    // Advance well past reconnectDelayMs to prove no reconnect fires later.
    await vi.advanceTimersByTimeAsync(500);

    expect(events.find((e) => e.type === 'reconnecting')).toBeUndefined();
    expect(client.connectionState).toBe('disconnected');
    expect(client.isReconnecting).toBe(false);

    client.dispose();
  });

  it('#2 emits "disconnected" exactly once (default autoReconnect=false)', async () => {
    adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const client = new VoltraClient({ adapter });
    client.subscribe((e) => events.push(e));

    await flushAndAwait(client.connect(device));
    events.length = 0;

    await flushAndAwait(client.disconnect());
    await vi.advanceTimersByTimeAsync(100);

    const disconnectedCount = events.filter((e) => e.type === 'disconnected').length;
    expect(disconnectedCount).toBe(1);
    expect(client.connectionState).toBe('disconnected');

    client.dispose();
  });

  it('guard: UNEXPECTED disconnect with autoReconnect=true STILL enters the reconnect path', async () => {
    // Proves the voluntary early-return in handleUnexpectedDisconnect did NOT
    // over-reach into the involuntary path: an adapter-level drop must still
    // trigger reconnect attempts. Paired with test #1 (voluntary fires NO
    // 'reconnecting'), this is a differential proof that the gate is scoped
    // to voluntary disconnects only.
    //
    // NOTE: we assert the reconnect ATTEMPT (a 'reconnecting' event), not a
    // return to 'connected'. Driving the reconnect all the way to 'connected'
    // is blocked by a SEPARATE, pre-existing defect (client.connect() throws
    // ALREADY_CONNECTED during the involuntary reconnect because
    // _connectionState is never reset to 'disconnected' first) — out of scope
    // for SDK-01.06 and unaffected by this fix.
    adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const client = new VoltraClient({
      adapter,
      autoReconnect: true,
      reconnectDelayMs: 20,
      maxReconnectAttempts: 3,
    });
    client.subscribe((e) => events.push(e));

    await flushAndAwait(client.connect(device));
    events.length = 0;

    // Adapter-level drop (NOT via client.disconnect) — the real reconnect path.
    adapter.simulateUnexpectedDisconnect();
    await flushAndAwait(Promise.resolve());

    expect(events.some((e) => e.type === 'reconnecting')).toBe(true);
    expect(client.isReconnecting).toBe(true);

    // Drain the attempts so no timers leak into the next test.
    await flushAndAwait(vi.advanceTimersByTimeAsync(200));

    client.dispose();
  });
});
