/**
 * `NoblePeripheral.write()` per-peripheral serialization tests.
 *
 * These tests prove the mutex behavior added 2026-05-11 to guard against
 * `@stoprocent/noble`'s `onceExclusive` corruption (see
 * `noble-once-exclusive-bug.test.ts` for the underlying bug). The
 * adapter-level invariants exercised here:
 *
 *   A2/A3. Concurrent `peripheral.write()` calls execute sequentially
 *          against the underlying noble characteristic — the SECOND
 *          `writeAsync` is not invoked until the FIRST resolves. All
 *          callers' promises eventually resolve in invocation order.
 *
 *   A4.    A rejecting write does not deadlock subsequent callers — the
 *          chain swallows the rejection at the queue pointer so the next
 *          write proceeds normally. The original error still propagates
 *          to the failing call's caller.
 *
 *   A5.    The mutex is per-instance — two separate `NoblePeripheral`
 *          objects can write concurrently without serialization between
 *          them.
 *
 * All tests use a controlled-timing fake characteristic (`FakeChar`) that
 * records every `writeAsync` invocation and lets the test driver release
 * them in any order. No real BLE traffic.
 */

import { describe, it, expect } from 'vitest';
import { NoblePeripheral } from '../node-noble';
import type { NobleCharacteristicLike, NoblePeripheralLike } from '../node-noble';
import type { BLEServiceConfig, PeripheralStatus } from '../types';
import { PeripheralLost } from '../types';

// =============================================================================
// Fake noble characteristic — records writeAsync calls and exposes a
// per-call deferred so the test driver controls ACK timing.
// =============================================================================

interface PendingWrite {
  /** Index of this write in the order the adapter invoked `writeAsync`. */
  callIndex: number;
  data: Buffer;
  withoutResponse: boolean;
  resolve: () => void;
  reject: (err: Error) => void;
}

class FakeChar implements NobleCharacteristicLike {
  readonly uuid: string = 'fake-write';
  readonly properties: string[] = ['write', 'notify'];

  /** Every writeAsync call lands here in invocation order. */
  readonly pending: PendingWrite[] = [];

  /**
   * Number of times `writeAsync` has been entered. Different from
   * `pending.length`: pending shrinks as the test resolves entries; this
   * counter is monotonic and reflects how many times the SDK actually
   * called the underlying char.
   */
  invocationCount = 0;

  async writeAsync(data: Buffer, withoutResponse: boolean): Promise<void> {
    const callIndex = this.invocationCount++;
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ callIndex, data, withoutResponse, resolve, reject });
    });
  }

  async subscribeAsync(): Promise<void> {
    // not used in these tests
  }

  async unsubscribeAsync(): Promise<void> {
    // not used in these tests
  }

  on(): unknown {
    return this;
  }

  removeListener(): unknown {
    return this;
  }

  /** Resolve the Nth pending write (by invocation index). */
  resolveCall(callIndex: number): void {
    const entry = this.pending.find((p) => p.callIndex === callIndex);
    if (!entry) {
      throw new Error(`No pending writeAsync call at index ${callIndex}`);
    }
    entry.resolve();
    this.pending.splice(this.pending.indexOf(entry), 1);
  }

  /** Reject the Nth pending write. */
  rejectCall(callIndex: number, err: Error): void {
    const entry = this.pending.find((p) => p.callIndex === callIndex);
    if (!entry) {
      throw new Error(`No pending writeAsync call at index ${callIndex}`);
    }
    entry.reject(err);
    this.pending.splice(this.pending.indexOf(entry), 1);
  }
}

// =============================================================================
// Fake noble peripheral — minimal stub. The mutex tests exercise only
// `write()`, so most of the peripheral lifecycle surface is unused.
// =============================================================================

class FakeUnderlying implements NoblePeripheralLike {
  readonly id: string;
  readonly address: string = '00:11:22:33:44:55';
  readonly advertisement: { localName?: string };
  readonly rssi: number = -50;
  state: 'error' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected' = 'connected';

  constructor(id: string, name = 'fake') {
    this.id = id;
    this.advertisement = { localName: name };
  }

  async connectAsync(): Promise<void> {
    this.state = 'connected';
  }

  async disconnectAsync(): Promise<void> {
    this.state = 'disconnected';
  }

  async discoverSomeServicesAndCharacteristicsAsync(): Promise<{
    services: unknown[];
    characteristics: NobleCharacteristicLike[];
  }> {
    return { services: [], characteristics: [] };
  }

  on(): unknown {
    return this;
  }

  removeListener(): unknown {
    return this;
  }
}

const FAKE_BLE_CONFIG: BLEServiceConfig = {
  serviceUUID: 'fake-service',
  writeCharUUID: 'fake-write',
  notifyCharUUID: 'fake-notify',
};

// =============================================================================
// Construction helper. The `NoblePeripheral.writeChar` and `_status`
// fields are normally populated by `_dial()`; we bypass dial here and
// inject them directly so each test starts in a known state without
// pulling the full noble lifecycle in.
// =============================================================================

interface PeripheralUnderTest {
  peripheral: NoblePeripheral;
  underlying: FakeUnderlying;
  char: FakeChar;
}

function makePeripheral(id = 'fake-peripheral-id'): PeripheralUnderTest {
  const underlying = new FakeUnderlying(id);
  const char = new FakeChar();
  const peripheral = new NoblePeripheral(underlying, id, 'fake', FAKE_BLE_CONFIG);

  // Bypass `_dial()`. We test the write path in isolation, so we wire up
  // the fields the write path depends on directly.
  const internals = peripheral as unknown as {
    writeChar: NobleCharacteristicLike | null;
    _status: PeripheralStatus;
  };
  internals.writeChar = char;
  internals._status = 'connected';

  return { peripheral, underlying, char };
}

/**
 * Race a promise against a microtask-flush sentinel. If the promise
 * settles within a few macrotasks it returns the settlement; otherwise
 * resolves to the literal string `'timeout'`. Used to detect non-progress
 * (i.e. the bug-without-mutex hang) without actually hanging the test.
 */
async function settleOrTimeout<T>(p: Promise<T>): Promise<T | 'timeout'> {
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 50));
  return Promise.race([p, timeout]);
}

// =============================================================================
// Tests
// =============================================================================

describe('NoblePeripheral.write — per-peripheral serialization', () => {
  it('serializes concurrent writes against the underlying char (A2/A3)', async () => {
    const { peripheral, char } = makePeripheral();

    // Fire 3 writes on the same tick. Without the mutex, all 3 hit
    // writeAsync immediately and the noble onceExclusive bug strands 2
    // of them. With the mutex, only the first should hit writeAsync;
    // subsequent calls wait their turn.
    const w1 = peripheral.write(new Uint8Array([0x01]));
    const w2 = peripheral.write(new Uint8Array([0x02]));
    const w3 = peripheral.write(new Uint8Array([0x03]));

    // Drain microtasks until the first write reaches writeAsync.
    while (char.invocationCount === 0) {
      await Promise.resolve();
    }

    // Only ONE writeAsync should be in flight — the mutex is holding
    // 2 and 3 back. The pending queue depth corroborates that the
    // mutex sits at the adapter layer, not deeper inside noble.
    expect(char.invocationCount).toBe(1);
    expect(char.pending).toHaveLength(1);
    expect(char.pending[0].data).toEqual(Buffer.from([0x01]));

    // Resolve the first write. The second should advance into writeAsync.
    char.resolveCall(0);
    while (char.invocationCount === 1) {
      await Promise.resolve();
    }

    expect(char.invocationCount).toBe(2);
    expect(char.pending[0].data).toEqual(Buffer.from([0x02]));

    // Resolve the second; third advances in.
    char.resolveCall(1);
    while (char.invocationCount === 2) {
      await Promise.resolve();
    }

    expect(char.invocationCount).toBe(3);
    expect(char.pending[0].data).toEqual(Buffer.from([0x03]));

    // Resolve the third. All three caller promises should now settle.
    char.resolveCall(2);

    await expect(w1).resolves.toBeUndefined();
    await expect(w2).resolves.toBeUndefined();
    await expect(w3).resolves.toBeUndefined();
  });

  it('preserves invocation order — first caller in is first to write', async () => {
    const { peripheral, char } = makePeripheral();

    const order: number[] = [];
    const w1 = peripheral.write(new Uint8Array([0xa1])).then(() => order.push(1));
    const w2 = peripheral.write(new Uint8Array([0xa2])).then(() => order.push(2));
    const w3 = peripheral.write(new Uint8Array([0xa3])).then(() => order.push(3));

    // Drive them to completion sequentially in the order they were queued.
    for (let i = 0; i < 3; i++) {
      // Wait for the queued write to land in writeAsync, then resolve it.
      while (char.pending.length === 0) {
        await Promise.resolve();
      }
      char.resolveCall(i);
    }

    await Promise.all([w1, w2, w3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('does not deadlock after a write rejects (A4)', async () => {
    const { peripheral, char } = makePeripheral();

    const w1 = peripheral.write(new Uint8Array([0x01]));
    const w2 = peripheral.write(new Uint8Array([0x02]));

    // Drive call 1 into writeAsync, then reject it.
    while (char.pending.length === 0) {
      await Promise.resolve();
    }
    char.rejectCall(0, new Error('simulated BLE write failure'));

    // Caller 1 sees a PeripheralLost (the SDK normalizes adapter
    // throws to PeripheralLost in `_writeImpl`).
    await expect(w1).rejects.toBeInstanceOf(PeripheralLost);

    // Critically, the chain pointer swallowed the rejection so call 2
    // still runs. But `_writeImpl`'s status check fires NEXT and sees
    // status === 'lost' (flipped by the failed call 1), so call 2
    // throws PeripheralLost instead of attempting another writeAsync.
    // This is the desired "fail fast on a dead link" semantic per
    // existing SDK contract.
    await expect(w2).rejects.toBeInstanceOf(PeripheralLost);

    // No second writeAsync was invoked — link-dead short-circuit
    // beats the queue.
    expect(char.invocationCount).toBe(1);
  });

  it('cross-peripheral writes do not block each other (A5)', async () => {
    const a = makePeripheral('peripheral-a');
    const b = makePeripheral('peripheral-b');

    const wa = a.peripheral.write(new Uint8Array([0xaa]));
    const wb = b.peripheral.write(new Uint8Array([0xbb]));

    // Both peripherals' writeAsync should be in-flight simultaneously.
    // The mutex is per-instance, not global.
    await Promise.resolve();
    await Promise.resolve();

    expect(a.char.invocationCount).toBe(1);
    expect(b.char.invocationCount).toBe(1);

    // Resolve B first — proves A is not blocking B.
    b.char.resolveCall(0);
    await expect(wb).resolves.toBeUndefined();

    // A is still pending until its own char resolves.
    const probeA = await settleOrTimeout(Promise.race([wa, Promise.resolve('still-pending')]));
    expect(probeA).toBe('still-pending');

    a.char.resolveCall(0);
    await expect(wa).resolves.toBeUndefined();
  });

  it('handles a 3-write cascade end-to-end without timeout', async () => {
    // Integration-style check: this is the exact Promise.all shape
    // bilateral.cascade uses. Without the mutex, this scenario hangs on
    // hardware. With the mutex, it should complete deterministically.
    const { peripheral, char } = makePeripheral();

    const cascadePromise = Promise.all([
      peripheral.write(new Uint8Array([0x01])),
      peripheral.write(new Uint8Array([0x02])),
      peripheral.write(new Uint8Array([0x03])),
    ]);

    // Auto-resolve each writeAsync as soon as it appears in `pending`.
    // Models a fast-acking device.
    const driver = (async () => {
      let drained = 0;
      while (drained < 3) {
        if (char.pending.length > 0) {
          char.resolveCall(drained);
          drained++;
        } else {
          await Promise.resolve();
        }
      }
    })();

    const result = await settleOrTimeout(cascadePromise);
    expect(result).not.toBe('timeout');
    expect(result).toEqual([undefined, undefined, undefined]);

    await driver;
    expect(char.invocationCount).toBe(3);
  });
});
