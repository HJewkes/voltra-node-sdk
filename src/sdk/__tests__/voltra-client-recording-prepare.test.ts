/**
 * SDK-01.13 regression — the recording-start sequence must not clobber the
 * selected fitness mode.
 *
 * `prepareRecording()` used to write `Workout.PREPARE` before `Workout.SETUP`.
 * PREPARE is a single-param write of `FITNESS_WORKOUT_STATE = WeightTraining`
 * (functionally `setMode(WeightTraining)`), so it silently reset a
 * previously-selected Damper/Isokinetic mode back to WeightTraining right
 * before GO. These tests pin the corrected sequence: SETUP (+ GO) only, no
 * PREPARE, so a mode selected via `setMode()` survives to engagement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { TrainingMode } from '../../voltra/protocol/constants';
import { hexToBytes } from '../../shared/utils';
import protocolData from '../../voltra/protocol/data/protocol-data.generated';
import type { ProtocolData } from '../../voltra/protocol/types';

const protocol = protocolData as ProtocolData;

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

function findWriteIndex(adapter: RecordingAdapter, expected: Uint8Array): number {
  for (let i = 0; i < adapter.writes.length; i++) {
    const w = adapter.writes[i];
    if (w.length === expected.length && w.every((b, j) => b === expected[j])) {
      return i;
    }
  }
  return -1;
}

const PREPARE = hexToBytes(protocol.commands.workout.prepare);
const SETUP = hexToBytes(protocol.commands.workout.setup);
const GO = hexToBytes(protocol.commands.workout.go);

describe('VoltraClient — recording start no longer clobbers mode (SDK-01.13)', () => {
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

  it('prepareRecording writes SETUP but never PREPARE', async () => {
    await flushAndAwait(client.prepareRecording());

    expect(findWriteIndex(adapter, SETUP)).toBeGreaterThanOrEqual(0);
    expect(findWriteIndex(adapter, PREPARE)).toBe(-1);
  });

  it('cold startRecording writes SETUP then GO, never PREPARE', async () => {
    await flushAndAwait(client.startRecording());

    const setupIdx = findWriteIndex(adapter, SETUP);
    const goIdx = findWriteIndex(adapter, GO);
    expect(setupIdx).toBeGreaterThanOrEqual(0);
    expect(goIdx).toBeGreaterThan(setupIdx);
    expect(findWriteIndex(adapter, PREPARE)).toBe(-1);
  });

  it('a mode selected before recording is not overwritten by the start sequence', async () => {
    const damper = hexToBytes(protocol.commands.modes.damper);

    await flushAndAwait(client.setMode(TrainingMode.Damper));
    const damperIdx = findWriteIndex(adapter, damper);
    expect(damperIdx).toBeGreaterThanOrEqual(0);

    await flushAndAwait(client.startRecording());

    // No PREPARE (= FITNESS_WORKOUT_STATE=WeightTraining) is written after the
    // Damper mode-select, so the device keeps the Damper mode into GO.
    expect(findWriteIndex(adapter, PREPARE)).toBe(-1);
    const goIdx = findWriteIndex(adapter, GO);
    expect(goIdx).toBeGreaterThan(damperIdx);
  });
});
