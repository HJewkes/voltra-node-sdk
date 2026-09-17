/**
 * VW-402 — the device, not the write ack, decides whether the motor stopped.
 *
 * Before this, `unloadDevice()` set the recording state to idle as soon as the
 * GATT write resolved, and `stopRecording()` caught any write error, warned,
 * and went idle anyway. Both reported a stop the device may never have made,
 * on the path the spoken "stop" rides.
 *
 * These tests drive a fake transport that only reports what the test tells it
 * to, so "the device answered" and "the write landed" can be told apart.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { ConnectionError, NotConnectedError } from '../../errors';
import { hexToBytes } from '../../shared/utils';
import {
  DEFAULT_SIMULATED_STATE,
  buildAcceptanceReport,
  buildCoreStateReply,
  isCoreStateRead,
  isHandshakeFinishWrite,
} from '../../testing/device-replies';
import protocolData from '../../voltra/protocol/data/protocol-data.generated';
import type { ProtocolData } from '../../voltra/protocol/types';

const protocol = protocolData as ProtocolData;
const motorConfig = protocol.commands.deviceState.motorState;
const STOP_FRAME = hexToBytes(protocol.commands.workout.stop);

/** Frame offsets the async-state decoder reads. */
const CMD_OFFSET = 10;
const PARAM_COUNT_OFFSET = 11;
const FIRST_PARAM_OFFSET = 13;
const ASYNC_STATE_CMD = 0x10;

/**
 * Build an inbound report the way the device reports one. Register ids come
 * from the generated catalog; nothing about the wire is written down here.
 */
function reportFrame(params: Array<{ field: string; value: number }>): Uint8Array {
  const frame = new Uint8Array(FIRST_PARAM_OFFSET + params.length * 4 + 2);
  frame[0] = 0x55;
  frame[1] = frame.length;
  frame[2] = 0x04;
  frame[CMD_OFFSET] = ASYNC_STATE_CMD;
  frame[PARAM_COUNT_OFFSET] = params.length;
  params.forEach(({ field, value }, i) => {
    const paramId = protocol.telemetry.parameterCatalog![field].paramId;
    const at = FIRST_PARAM_OFFSET + i * 4;
    frame[at] = paramId & 0xff;
    frame[at + 1] = (paramId >> 8) & 0xff;
    frame[at + 2] = value & 0xff;
    frame[at + 3] = (value >> 8) & 0xff;
  });
  return frame;
}

function motorReportFrame(value: number): Uint8Array {
  return reportFrame([{ field: motorConfig.field, value }]);
}

const RELEASED_REPORT = motorReportFrame(motorConfig.released[0]);
const ENGAGED_REPORT = motorReportFrame(motorConfig.engaged[0]);
const WEIGHT_FIELD = protocol.telemetry.paramIds.baseWeight;

function isStopWrite(data: Uint8Array): boolean {
  return data.length === STOP_FRAME.length && data.every((b, i) => b === STOP_FRAME[i]);
}

class FakeTransport extends BaseBLEAdapter {
  readonly writes: Uint8Array[] = [];
  /** Pushed back at the caller when a stop write lands. */
  reportOnStop: Uint8Array | null = null;
  failStopWrites = false;
  /**
   * Whether the device answers a core-state read. Off for the tests that need
   * the unload's fallback read to go unanswered.
   */
  answerStateReads = true;

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
    if (this.failStopWrites && isStopWrite(data)) {
      throw new Error('write rejected');
    }
    this.writes.push(new Uint8Array(data));
    if (this.reportOnStop && isStopWrite(data)) {
      this.push(this.reportOnStop);
    }
    if (isHandshakeFinishWrite(data)) {
      this.push(buildAcceptanceReport());
    }
    if (this.answerStateReads && isCoreStateRead(data)) {
      this.push(buildCoreStateReply(DEFAULT_SIMULATED_STATE));
    }
  }

  /** Deliver an inbound frame as the device would. */
  push(data: Uint8Array): void {
    this.emitNotification(data);
  }

  countWrites(frame: Uint8Array): number {
    return this.writes.filter((w) => w.length === frame.length && w.every((b, i) => b === frame[i]))
      .length;
  }
}

const device: Device = { id: 'device-vw402', name: 'VTR-VW4020', rssi: -55 };

async function flushAndAwait<T>(promise: Promise<T>): Promise<T> {
  while (true) {
    const settled = await Promise.race([
      promise.then((value) => ({ done: true as const, value })),
      Promise.resolve().then(() => ({ done: false as const })),
    ]);
    if (settled.done) return settled.value;
    await vi.advanceTimersByTimeAsync(50);
  }
}

describe('VoltraClient — motor state is what the device reported', () => {
  let adapter: FakeTransport;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new FakeTransport();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
    // The connect-time read has answered; from here the device stays silent
    // unless a test says otherwise, so an unconfirmed stop stays unconfirmed.
    adapter.answerStateReads = false;
    adapter.writes.length = 0;
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('reports the motor state the connect-time state read returned', () => {
    // The simulated device reports a released motor at connect; nothing here
    // was inferred from a write.
    expect(client.motorState).toBe('unloaded');
  });

  it('leaves the motor state unknown when the write lands but nothing is reported', async () => {
    await flushAndAwait(client.unloadDevice());

    expect(adapter.countWrites(STOP_FRAME)).toBe(1);
    expect(client.motorState).toBe('unknown');
  });

  it('reads state back once before giving up on an unanswered unload', async () => {
    await flushAndAwait(client.unloadDevice());

    // The stop, plus one read frame that is not another stop.
    expect(adapter.writes.length).toBeGreaterThan(1);
    expect(adapter.countWrites(STOP_FRAME)).toBe(1);
  });

  it('does not let a report from before the write confirm the unload', async () => {
    adapter.push(RELEASED_REPORT);
    expect(client.motorState).toBe('unloaded');

    await flushAndAwait(client.unloadDevice());

    expect(client.motorState).toBe('unknown');
  });

  it('confirms the unload on a report that follows the write', async () => {
    adapter.reportOnStop = RELEASED_REPORT;

    await flushAndAwait(client.unloadDevice());

    expect(client.motorState).toBe('unloaded');
  });

  it('does not treat a report of the opposite state as confirmation', async () => {
    adapter.reportOnStop = ENGAGED_REPORT;

    await flushAndAwait(client.unloadDevice());

    expect(client.motorState).toBe('engaged');
  });

  it('throws and leaves the motor state unknown when the stop write fails', async () => {
    adapter.failStopWrites = true;

    await expect(flushAndAwait(client.unloadDevice())).rejects.toBeInstanceOf(ConnectionError);
    expect(client.motorState).toBe('unknown');
  });

  it('refuses an unload from a disconnected client rather than reporting one', async () => {
    const stranded = new VoltraClient({ adapter: new FakeTransport() });

    await expect(stranded.unloadDevice()).rejects.toBeInstanceOf(NotConnectedError);
    expect(stranded.motorState).toBe('unknown');
  });
});

describe('VoltraClient — stopRecording no longer swallows a failed stop', () => {
  let adapter: FakeTransport;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new FakeTransport();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
    await flushAndAwait(client.startRecording());
    adapter.answerStateReads = false;
    adapter.writes.length = 0;
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('rejects and stays out of idle when the stop write fails', async () => {
    adapter.failStopWrites = true;

    await expect(flushAndAwait(client.stopRecording())).rejects.toBeInstanceOf(ConnectionError);
    expect(client.motorState).toBe('unknown');
    expect(client.recordingState).not.toBe('active');
  });

  it('stays out of idle when the write lands but the device says nothing', async () => {
    await flushAndAwait(client.stopRecording());

    expect(client.recordingState).toBe('stopping');
    expect(client.motorState).toBe('unknown');
  });

  it('reaches idle once the device reports the release', async () => {
    adapter.reportOnStop = RELEASED_REPORT;

    await flushAndAwait(client.stopRecording());

    expect(client.recordingState).toBe('idle');
    expect(client.motorState).toBe('unloaded');
  });
});

describe('VoltraClient — requested settings are separate from confirmed ones', () => {
  let adapter: FakeTransport;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new FakeTransport();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
    // The connect-time read has answered; from here the device stays silent
    // unless a test says otherwise, so an unconfirmed stop stays unconfirmed.
    adapter.answerStateReads = false;
    adapter.writes.length = 0;
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('records a written weight as requested, not confirmed', async () => {
    await flushAndAwait(client.setWeight(123));

    expect(client.requestedSettings.weight).toBe(123);
    expect(client.confirmedSettings.weight).not.toBe(123);
  });

  it('moves the value from requested to confirmed once the device reports it', async () => {
    await flushAndAwait(client.setWeight(123));

    adapter.push(reportFrame([{ field: WEIGHT_FIELD, value: 123 }]));

    expect(client.confirmedSettings.weight).toBe(123);
    expect(client.requestedSettings.weight).toBeUndefined();
  });

  it('clears confirmed state and motor state on disconnect', async () => {
    adapter.push(ENGAGED_REPORT);
    expect(client.motorState).toBe('engaged');

    await flushAndAwait(client.disconnect());

    expect(client.motorState).toBe('unknown');
    expect(client.confirmedSettings).toEqual({});
  });

  it('replays no motor command when the connection comes back', async () => {
    adapter.reportOnStop = RELEASED_REPORT;
    await flushAndAwait(client.unloadDevice());
    await flushAndAwait(client.disconnect());
    adapter.writes.length = 0;

    await flushAndAwait(client.connect(device));

    expect(adapter.countWrites(STOP_FRAME)).toBe(0);
    expect(client.motorState).toBe('unknown');
  });
});
