/**
 * Tests for the guided-load (direct-load, Phase 1g) flow on VoltraClient.
 *
 * Covers:
 *   - `startGuidedLoad` writes the BP_BASE_WEIGHT setter, the 0xAA 0x12
 *     trigger, and arms a 500ms polling loop for 18 seconds.
 *   - `onGuidedLoadState` fires synthesized 'armed' / 'timeout' / 'exited'
 *     transitions plus decoded transitions ('countdown' / 'active') driven
 *     by injected multi-param status notifications.
 *   - `exitGuidedLoad` cancels the polling loop and writes the
 *     BP_SET_FITNESS_MODE = 0x0004 frame.
 *   - Polling stops automatically once the device reports 'active'.
 *
 * Uses vitest fake timers exclusively for timing — no real-time waits.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { CommandError, NotConnectedError } from '../../errors';
import {
  buildGuidedLoadStatusReadFrame,
  buildGuidedLoadTriggerFrame,
  buildGuidedLoadExitFrame,
} from '../../voltra/protocol/guided-load';
import { NotificationConfigs } from '../../voltra/protocol/constants';
import type { GuidedLoadState } from '../types';

class RecordingAdapter extends BaseBLEAdapter {
  readonly writes: Uint8Array[] = [];

  async scan(_timeout: number): Promise<Device[]> {
    return [];
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

  inject(data: Uint8Array): void {
    this.emitNotification(data);
  }
}

const device: Device = { id: 'device-x', name: 'VTR-XYZXYZ', rssi: -55 };

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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function findWrite(adapter: RecordingAdapter, expected: Uint8Array): number {
  for (let i = 0; i < adapter.writes.length; i++) {
    if (bytesEqual(adapter.writes[i], expected)) return i;
  }
  return -1;
}

/**
 * Build a multi-param notification carrying the supplied paramId/value
 * pairs. Same shape used by the protocol-level decoder tests.
 */
function buildMultiParamNotification(
  params: Array<{ paramIdLeHex: string; value: number; uint16: boolean }>
): Uint8Array {
  const cfg = NotificationConfigs.multiParam;
  let payloadLen = cfg.firstParamOffset!;
  for (const p of params) {
    payloadLen += 2 + (p.uint16 ? 2 : 1);
  }
  const buf = new Uint8Array(payloadLen);
  const header = cfg.header.match(/.{2}/g)!.map((b) => parseInt(b, 16));
  buf[0] = header[0];
  buf[1] = header[1];
  buf[cfg.paramCountOffset!] = params.length;
  let offset = cfg.firstParamOffset!;
  for (const p of params) {
    const id = p.paramIdLeHex.match(/.{2}/g)!.map((b) => parseInt(b, 16));
    buf[offset] = id[0];
    buf[offset + 1] = id[1];
    offset += 2;
    if (p.uint16) {
      buf[offset] = p.value & 0xff;
      buf[offset + 1] = (p.value >> 8) & 0xff;
      offset += 2;
    } else {
      buf[offset] = p.value & 0xff;
      offset += 1;
    }
  }
  return buf;
}

describe('VoltraClient — startGuidedLoad', () => {
  let adapter: RecordingAdapter;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new RecordingAdapter();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
    adapter.writes.length = 0;
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('throws NotConnectedError when called on a disconnected client', async () => {
    const stand = new VoltraClient({ adapter: new RecordingAdapter() });
    await expect(stand.startGuidedLoad({ targetWeightLbs: 50 })).rejects.toBeInstanceOf(
      NotConnectedError
    );
  });

  it('writes BP_BASE_WEIGHT (setWeight) followed by the 0xAA 0x12 trigger', async () => {
    await client.startGuidedLoad({ targetWeightLbs: 50 });

    // The first write should be a setWeight command (delegating to existing
    // setter), the next-or-later should be the trigger frame.
    const trigger = buildGuidedLoadTriggerFrame();
    const triggerIdx = findWrite(adapter, trigger);
    expect(triggerIdx).toBeGreaterThanOrEqual(0);
    // The write at index 0 is setWeight (we don't introspect its bytes here
    // beyond asserting it ran first); the trigger MUST come after it.
    expect(adapter.writes.length).toBeGreaterThanOrEqual(2);
    expect(triggerIdx).toBeGreaterThan(0);
  });

  it('emits a synthesized armed state immediately after the trigger', async () => {
    const seen: GuidedLoadState[] = [];
    client.onGuidedLoadState((s) => seen.push(s));
    await client.startGuidedLoad({ targetWeightLbs: 50 });

    // First emission: synthesized 'armed' (no countdown/mode info yet).
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0].phase).toBe('armed');
    expect(seen[0].countdownRemainingMs).toBeNull();
    expect(seen[0].fitnessModeRaw).toBeNull();
  });

  it('rejects when called twice without an exit in between', async () => {
    await client.startGuidedLoad({ targetWeightLbs: 50 });
    await expect(client.startGuidedLoad({ targetWeightLbs: 60 })).rejects.toBeInstanceOf(
      CommandError
    );
  });

  it('polls the 4 status registers every 500ms by default', async () => {
    await client.startGuidedLoad({ targetWeightLbs: 50 });
    const expectedRead = buildGuidedLoadStatusReadFrame();
    const writesBeforeAdvance = adapter.writes.length;

    // After 500ms the first poll should have written the read frame.
    await vi.advanceTimersByTimeAsync(500);
    const afterFirst = findWrite(adapter, expectedRead);
    expect(afterFirst).toBeGreaterThanOrEqual(writesBeforeAdvance);

    // After another 500ms a second read frame should have been written.
    const countAfterFirst = adapter.writes.filter((w) => bytesEqual(w, expectedRead)).length;
    await vi.advanceTimersByTimeAsync(500);
    const countAfterSecond = adapter.writes.filter((w) => bytesEqual(w, expectedRead)).length;
    expect(countAfterSecond).toBe(countAfterFirst + 1);
  });

  it('honors a custom pollIntervalMs', async () => {
    await client.startGuidedLoad({ targetWeightLbs: 50, pollIntervalMs: 1000 });
    const expectedRead = buildGuidedLoadStatusReadFrame();

    // No poll write at 500ms — the interval is 1000ms.
    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.writes.filter((w) => bytesEqual(w, expectedRead)).length).toBe(0);

    // First poll write at 1000ms.
    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.writes.filter((w) => bytesEqual(w, expectedRead)).length).toBe(1);
  });

  it('transitions to countdown when 0x53C8 reports a non-zero countdown', async () => {
    const seen: GuidedLoadState[] = [];
    client.onGuidedLoadState((s) => seen.push(s));
    await client.startGuidedLoad({ targetWeightLbs: 50 });
    seen.length = 0; // ignore the initial synthesized 'armed'

    adapter.inject(
      buildMultiParamNotification([
        { paramIdLeHex: '893e', value: 0x0026, uint16: true }, // mode=READY
        { paramIdLeHex: 'c853', value: 2500, uint16: true }, // countdown=2500ms
      ])
    );

    expect(seen.length).toBeGreaterThanOrEqual(1);
    const last = seen[seen.length - 1];
    expect(last.phase).toBe('countdown');
    expect(last.countdownRemainingMs).toBe(2500);
    expect(last.fitnessModeRaw).toBe(0x0026);
  });

  it('transitions to active when fitness-mode flips to 0x0027 and stops polling', async () => {
    const seen: GuidedLoadState[] = [];
    client.onGuidedLoadState((s) => seen.push(s));
    await client.startGuidedLoad({ targetWeightLbs: 50 });

    // Move forward past two poll cycles so we have several writes recorded.
    await vi.advanceTimersByTimeAsync(1100);
    const expectedRead = buildGuidedLoadStatusReadFrame();
    const pollWritesBefore = adapter.writes.filter((w) => bytesEqual(w, expectedRead)).length;
    expect(pollWritesBefore).toBeGreaterThan(0);

    adapter.inject(
      buildMultiParamNotification([
        { paramIdLeHex: '893e', value: 0x0027, uint16: true }, // mode=ACTIVE
      ])
    );

    const last = seen[seen.length - 1];
    expect(last.phase).toBe('active');
    expect(last.fitnessModeRaw).toBe(0x0027);

    // Advancing further should NOT produce additional poll writes — the
    // client auto-stops polling once 'active' arrives.
    await vi.advanceTimersByTimeAsync(2000);
    const pollWritesAfter = adapter.writes.filter((w) => bytesEqual(w, expectedRead)).length;
    expect(pollWritesAfter).toBe(pollWritesBefore);
  });

  it('emits a timeout phase when the 18s window closes without reaching active', async () => {
    const seen: GuidedLoadState[] = [];
    client.onGuidedLoadState((s) => seen.push(s));
    await client.startGuidedLoad({ targetWeightLbs: 50 });

    // No notifications injected — fast-forward to just before the timeout.
    await vi.advanceTimersByTimeAsync(17000);
    expect(seen[seen.length - 1].phase).not.toBe('timeout');

    // Cross the 18000ms boundary.
    await vi.advanceTimersByTimeAsync(2000);
    const last = seen[seen.length - 1];
    expect(last.phase).toBe('timeout');
  });

  it('honors a custom pollDurationMs for the timeout window', async () => {
    const seen: GuidedLoadState[] = [];
    client.onGuidedLoadState((s) => seen.push(s));
    await client.startGuidedLoad({ targetWeightLbs: 50, pollDurationMs: 5000 });

    await vi.advanceTimersByTimeAsync(4500);
    expect(seen[seen.length - 1].phase).not.toBe('timeout');

    await vi.advanceTimersByTimeAsync(600);
    expect(seen[seen.length - 1].phase).toBe('timeout');
  });
});

describe('VoltraClient — exitGuidedLoad', () => {
  let adapter: RecordingAdapter;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new RecordingAdapter();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
    adapter.writes.length = 0;
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('writes the exit frame and emits an exited state', async () => {
    const seen: GuidedLoadState[] = [];
    client.onGuidedLoadState((s) => seen.push(s));

    await client.startGuidedLoad({ targetWeightLbs: 50 });
    seen.length = 0;

    await client.exitGuidedLoad();

    const expectedExit = buildGuidedLoadExitFrame();
    expect(findWrite(adapter, expectedExit)).toBeGreaterThanOrEqual(0);
    expect(seen[seen.length - 1].phase).toBe('exited');
  });

  it('stops polling after exit', async () => {
    await client.startGuidedLoad({ targetWeightLbs: 50 });
    await vi.advanceTimersByTimeAsync(500); // one poll
    const expectedRead = buildGuidedLoadStatusReadFrame();
    const pollsBefore = adapter.writes.filter((w) => bytesEqual(w, expectedRead)).length;
    expect(pollsBefore).toBeGreaterThan(0);

    await client.exitGuidedLoad();

    await vi.advanceTimersByTimeAsync(2000);
    const pollsAfter = adapter.writes.filter((w) => bytesEqual(w, expectedRead)).length;
    expect(pollsAfter).toBe(pollsBefore);
  });
});
