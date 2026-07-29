/**
 * Regression: `@stoprocent/noble`'s `onceExclusive` corruption under
 * concurrent operations.
 *
 * Filed 2026-05-11 alongside `sources/archive/handoffs/FINDING-2026-05-10-cascade-write-hang.md`.
 *
 * Root cause: `Characteristic.write()` registers its result callback via
 * `onceExclusive('write', cb)`. `onceExclusive` REMOVES any previously
 * registered listener before adding the new one — so 3 concurrent
 * `writeAsync` calls leave only the LAST callback attached. The first ACK
 * fires it; the other two ACKs hit zero listeners and are silently dropped.
 * Calls 1 and 2 hang forever despite the device having received and applied
 * the bytes.
 *
 * This file pins TWO things:
 *
 *  1. The bug is present in the noble version we depend on. If noble fixes
 *     `onceExclusive` upstream, the first test below will fail — at which
 *     point we can revisit (and possibly remove) the SDK-side write mutex
 *     in `node-noble.ts`.
 *
 *  2. The exact failure mode: only the LAST registrant fires; prior
 *     callbacks never fire, even after multiple subsequent emits. (The
 *     subtle secondary bug in the FINDING — that the last callback resolves
 *     on whichever ACK arrives FIRST regardless of which write that ACK was
 *     for — is a property of `once` semantics and is implicit here.)
 *
 * See: sources/archive/handoffs/FINDING-2026-05-10-cascade-write-hang.md §"Root cause"
 *      voltra-node-sdk/src/bluetooth/adapters/node-noble.ts:write()
 */

import { describe, it, expect } from 'vitest';

// Deep import: the emitter is internal to the noble package (not surfaced via
// the main entry). Stable across 2.5.x — the file path is unchanged since the
// `onceExclusive` method was introduced. If a future noble release moves or
// renames this file, this require will throw and the test will fail loudly,
// which is the desired signal: re-evaluate whether the upstream fixed the bug.
//
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NobleEventEmitter = require('@stoprocent/noble/lib/noble-event-emitter');

interface NobleEventEmitterShape {
  onceExclusive(event: string, callback: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): boolean;
}

describe('@stoprocent/noble onceExclusive — concurrent-operation corruption', () => {
  it('drops all prior callbacks when a new onceExclusive is registered', () => {
    const emitter = new NobleEventEmitter() as NobleEventEmitterShape;
    const fired: string[] = [];

    // Three concurrent writeAsync calls would each invoke onceExclusive('write', cb)
    // before any ACK has arrived — modelled here by three sequential
    // registrations with no intervening emit, which is what the JS event loop
    // sees when Promise.all fans out three writeAsyncs on the same tick.
    emitter.onceExclusive('write', () => fired.push('cb1'));
    emitter.onceExclusive('write', () => fired.push('cb2'));
    emitter.onceExclusive('write', () => fired.push('cb3'));

    // First ACK arrives. With correct semantics for a write API, all three
    // should eventually be resolved (one per ACK). With onceExclusive only
    // cb3 is still registered, so only cb3 fires.
    emitter.emit('write');

    expect(fired).toEqual(['cb3']);

    // Subsequent ACKs (real second + third Write Response packets from the
    // device) emit on a now-empty listener set. They are silently dropped —
    // cb1 and cb2 never fire.
    emitter.emit('write');
    emitter.emit('write');

    expect(fired).toEqual(['cb3']);
  });

  it('also corrupts a 2-call concurrent pattern (not just 3+)', () => {
    // The earlier finding (`FINDING-2026-05-10-cascade-write-hang.md`)
    // listed "test if 2-write concurrent also hangs" as an open question.
    // This unit test settles it: 2 concurrent writes hit the same bug.
    const emitter = new NobleEventEmitter() as NobleEventEmitterShape;
    const fired: string[] = [];

    emitter.onceExclusive('write', () => fired.push('cb1'));
    emitter.onceExclusive('write', () => fired.push('cb2'));

    emitter.emit('write');
    emitter.emit('write');

    // Only cb2 fires. cb1 was unregistered when cb2 was added, and the
    // second emit has no remaining listeners.
    expect(fired).toEqual(['cb2']);
  });

  it('is symmetric across event names — read/notify/etc. are all affected', () => {
    // Quick demonstration that this isn't write-specific. Any noble code
    // path that registers `onceExclusive` more than once before its event
    // fires will lose the prior callback. Today the SDK only exercises
    // writes concurrently (per `node-noble.ts:write`), but this test
    // guards future SDK code from accidentally relying on concurrent
    // discoveries / reads / subscribes against the same characteristic.
    const emitter = new NobleEventEmitter() as NobleEventEmitterShape;
    const fired: string[] = [];

    emitter.onceExclusive('valueRead', () => fired.push('read1'));
    emitter.onceExclusive('valueRead', () => fired.push('read2'));
    emitter.emit('valueRead');

    expect(fired).toEqual(['read2']);
  });

  it('does NOT corrupt independent events — only same-event registrations conflict', () => {
    // Sanity-check that onceExclusive's exclusivity is per-event, not
    // global. If this ever broke, the SDK's connect-time discovery
    // (multiple distinct event names registered in parallel) would also
    // need a mutex.
    const emitter = new NobleEventEmitter() as NobleEventEmitterShape;
    const fired: string[] = [];

    emitter.onceExclusive('write', () => fired.push('write-cb'));
    emitter.onceExclusive('valueRead', () => fired.push('read-cb'));

    emitter.emit('write');
    emitter.emit('valueRead');

    expect(fired.sort()).toEqual(['read-cb', 'write-cb']);
  });
});
