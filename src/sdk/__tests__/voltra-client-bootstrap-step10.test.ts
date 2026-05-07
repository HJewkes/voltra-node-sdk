/**
 * Bootstrap step 10 — historical regression tests.
 *
 * The cmd=0x0F bulk-read packet was appended to `Init.SEQUENCE` in 0.7.0 as
 * the Bug 17 fix (post-reconnect settings cascade). On real hardware
 * (VTR-097082, 2026-05-07) this packet caused the firmware to drop the GATT
 * link mid-bootstrap, producing the `_connectionState='connected'` /
 * `writeChar=null` state split documented in Bug 30. The 0.7.2 hotfix
 * reverts that append.
 *
 * These tests now lock in:
 * 1. `Init.SEQUENCE` does NOT include the step-10 query packet (regression
 *    guard — re-introducing it would re-open Bug 30 unless the underlying
 *    firmware behavior is understood).
 * 2. The `cmd=0x0F` response decoder still works when invoked directly,
 *    populating `client.settings` from a simulated device frame. This
 *    keeps the decoder live for a future safer invocation path.
 * 3. `cleanup()` still does NOT blanket-reset `_settings` to defaults —
 *    last-known settings persist across disconnect, which is a net
 *    improvement over pre-0.7.0 behavior even without step 10 in flight.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { Init } from '../../voltra/protocol/constants';
import { ParamIdHex, TrainingMode } from '../../voltra/protocol/constants';

const STEP_10_QUERY_HEX_MARKER = '553304c2'; // first 4 bytes of step-10 envelope
const FRAME_TYPE_RESPONSE = 0x08;
const CMD_PARAM_READ = 0x0f;

class MockAdapter extends BaseBLEAdapter {
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

  /**
   * Push a notification frame from the simulated device into the client's
   * decode pipeline. Used to inject a cmd=0x0F response directly.
   */
  pushNotification(data: Uint8Array): void {
    this.emitNotification(data);
  }
}

const device: Device = { id: 'device-bug17', name: 'VTR-BUG017', rssi: -55 };

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

function bytesToHexLower(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build a synthetic cmd=0x0F response carrying paramId+value pairs. Frame
 * structure mirrors the real wire format: `55 LEN 08 CRC8 SENDER RECEIVER
 * SEQ_LO SEQ_HI 20 00 0F 00 COUNT_LO COUNT_HI ...payload CRC16`. CRC values
 * are placeholders — the SDK decoder does not validate them.
 */
function buildCmd0x0FResponse(
  params: Array<{ paramIdHex: string; valueBytes: number[] }>
): Uint8Array {
  const header = [
    0x55,
    0x00, // length placeholder
    FRAME_TYPE_RESPONSE,
    0x00, // crc8 (synthetic)
    0x10,
    0xaa, // sender / receiver
    0x06,
    0x00, // sequence
    0x20,
    0x00, // proto
    CMD_PARAM_READ,
    0x00, // result
    params.length & 0xff,
    (params.length >> 8) & 0xff,
  ];
  const payload: number[] = [];
  for (const p of params) {
    payload.push(parseInt(p.paramIdHex.slice(0, 2), 16));
    payload.push(parseInt(p.paramIdHex.slice(2, 4), 16));
    payload.push(...p.valueBytes);
  }
  const crc16 = [0x00, 0x00];
  const all = [...header, ...payload, ...crc16];
  all[1] = all.length - 1; // length = total - magic byte
  return new Uint8Array(all);
}

describe('Bug 30 regression — Init.SEQUENCE does NOT include step-10 query', () => {
  it('contains only the connect-request + handshake-finish packets', () => {
    const sequenceHexes = Init.SEQUENCE.map(bytesToHexLower);
    for (const hex of sequenceHexes) {
      expect(hex.startsWith(STEP_10_QUERY_HEX_MARKER)).toBe(false);
    }
  });

  it('does not write the step-10 packet during connect', async () => {
    vi.useFakeTimers();
    const adapter = new MockAdapter();
    const client = new VoltraClient({ adapter });
    try {
      await flushAndAwait(client.connect(device));

      const sentStep10 = adapter.writes.some((w) =>
        bytesToHexLower(w).startsWith(STEP_10_QUERY_HEX_MARKER)
      );
      expect(sentStep10).toBe(false);
    } finally {
      client.dispose();
      vi.useRealTimers();
    }
  });
});

describe('cmd=0x0F decoder still wired — direct injection populates client.settings', () => {
  let adapter: MockAdapter;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new MockAdapter();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('updates client.settings from a simulated cmd=0x0F response', () => {
    const response = buildCmd0x0FResponse([
      { paramIdHex: ParamIdHex.BASE_WEIGHT, valueBytes: [60, 0] },
      { paramIdHex: ParamIdHex.CHAINS, valueBytes: [10, 0] },
      { paramIdHex: ParamIdHex.TRAINING_MODE, valueBytes: [TrainingMode.Damper] },
      { paramIdHex: '0351', valueBytes: [5] }, // damperLevel (wire byte order — corrected per B4)
    ]);

    adapter.pushNotification(response);

    expect(client.settings.weight).toBe(60);
    expect(client.settings.chains).toBe(10);
    expect(client.settings.mode).toBe(TrainingMode.Damper);
    expect(client.settings.damperLevel).toBe(5);
  });
});

describe('disconnect/reconnect preserves last-known settings (PR #40 behavior retained)', () => {
  it('keeps populated settings across disconnect (no blanket reset on cleanup)', async () => {
    vi.useFakeTimers();
    const adapter = new MockAdapter();
    const client = new VoltraClient({ adapter });
    try {
      await flushAndAwait(client.connect(device));

      // Simulate the device pushing a settings cascade (e.g., from a future
      // safer invocation path or from a write that triggers cmd=0x10).
      adapter.pushNotification(
        buildCmd0x0FResponse([
          { paramIdHex: ParamIdHex.BASE_WEIGHT, valueBytes: [80, 0] },
          { paramIdHex: ParamIdHex.TRAINING_MODE, valueBytes: [TrainingMode.WeightTraining] },
        ])
      );
      expect(client.settings.weight).toBe(80);
      expect(client.settings.mode).toBe(TrainingMode.WeightTraining);

      // Disconnect — pre-PR-40 code would have wiped these to DEFAULT_SETTINGS
      // here. The 0.7.2 revert only undoes the Init.SEQUENCE append; it keeps
      // the no-blanket-reset behavior.
      await flushAndAwait(client.disconnect());

      expect(client.settings.weight).toBe(80);
      expect(client.settings.mode).toBe(TrainingMode.WeightTraining);
    } finally {
      client.dispose();
      vi.useRealTimers();
    }
  });
});
