/**
 * Bug 17 — Bootstrap step 10 + post-reconnect settings preservation tests.
 *
 * Verifies:
 * 1. Init.SEQUENCE includes the 18-param mode-feature-state query packet, so
 *    the device produces a settings cascade on every connect.
 * 2. A simulated cmd=0x0F response received during connect populates
 *    `client.settings` via `syncSettingsFromDevice`.
 * 3. `cleanup()` no longer blanket-resets `_settings` to defaults — last-known
 *    settings persist across disconnect (the proximate cause of Bug 17).
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
   * decode pipeline. Used to inject the cmd=0x0F response that step 10 would
   * normally trigger.
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

describe('Bug 17 — Init.SEQUENCE includes the bootstrap step-10 query', () => {
  it('appends the 18-param mode-feature-state query packet', () => {
    const last = Init.SEQUENCE[Init.SEQUENCE.length - 1];
    const hex = bytesToHexLower(last);
    // Step-10 envelope from voltra-private/research/data-port-2026-05-07-android-deep.md § 9.
    expect(hex).toBe(
      '553304c2aa10060020000f1200863e62536153b753b653e3520651873e883eb053c653893eb04f3154d253823e6a50bc54985a'
    );
  });

  it('writes the step-10 packet during connect (verifies the runtime sends it)', async () => {
    vi.useFakeTimers();
    const adapter = new MockAdapter();
    const client = new VoltraClient({ adapter });
    try {
      await flushAndAwait(client.connect(device));

      const sentStep10 = adapter.writes.some((w) =>
        bytesToHexLower(w).startsWith(STEP_10_QUERY_HEX_MARKER)
      );
      expect(sentStep10).toBe(true);
    } finally {
      client.dispose();
      vi.useRealTimers();
    }
  });
});

describe('Bug 17 — cmd=0x0F response populates client.settings', () => {
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

describe('Bug 17 — disconnect/reconnect preserves last-known settings', () => {
  it('keeps populated settings across disconnect (no blanket reset on cleanup)', async () => {
    vi.useFakeTimers();
    const adapter = new MockAdapter();
    const client = new VoltraClient({ adapter });
    try {
      await flushAndAwait(client.connect(device));

      // Simulate the device pushing a settings cascade.
      adapter.pushNotification(
        buildCmd0x0FResponse([
          { paramIdHex: ParamIdHex.BASE_WEIGHT, valueBytes: [80, 0] },
          { paramIdHex: ParamIdHex.TRAINING_MODE, valueBytes: [TrainingMode.WeightTraining] },
        ])
      );
      expect(client.settings.weight).toBe(80);
      expect(client.settings.mode).toBe(TrainingMode.WeightTraining);

      // Disconnect — pre-fix code would have wiped these to DEFAULT_SETTINGS
      // here, leaving consumers reading defaults until a write triggered an
      // async cmd=0x10 update.
      await flushAndAwait(client.disconnect());

      expect(client.settings.weight).toBe(80);
      expect(client.settings.mode).toBe(TrainingMode.WeightTraining);
    } finally {
      client.dispose();
      vi.useRealTimers();
    }
  });
});
