/**
 * VW-403 — a connection exists once the device says it does, and control
 * values are unknown until the device reports them.
 *
 * Before this, `connect()` wrote the init frames, waited out fixed delays and
 * declared success. The device's own acceptance report was never decoded, and
 * nothing re-read state afterwards — so a reconnect to a device whose weight
 * and mode had changed underneath reported the previous connection's values.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { ConnectionError, DeviceStateUnknownError } from '../../errors';
import { TrainingMode } from '../../voltra/protocol/constants';
import { hexToBytes } from '../../shared/utils';
import {
  ACCEPTANCE_STATUS_OK,
  buildAcceptanceReport,
  buildCoreStateReply,
  isCoreStateRead,
  isHandshakeFinishWrite,
  type CoreStateReply,
} from '../../testing/device-replies';
import { encodeBulkParamResponse } from '../../voltra/protocol/telemetry-decoder';
import protocolData from '../../voltra/protocol/data/protocol-data.generated';
import type { ProtocolData } from '../../voltra/protocol/types';

const protocol = protocolData as ProtocolData;
const CONTROL_WRITES = [
  hexToBytes(protocol.commands.workout.go),
  hexToBytes(protocol.commands.workout.stop),
  hexToBytes(protocol.commands.weights['50']),
  hexToBytes(protocol.commands.modes.weightTraining),
];

/** How the simulated device answers the handshake finish. */
type AcceptanceBehaviour = 'immediate' | 'delayed' | 'refuse' | 'silent';

class ScriptedDevice extends BaseBLEAdapter {
  readonly writes: Uint8Array[] = [];
  acceptance: AcceptanceBehaviour = 'immediate';
  /** Milliseconds the device takes to answer, for `'delayed'`. */
  acceptanceDelayMs = 15_000;
  /** Status sent when `acceptance` is `'refuse'`. */
  refusalStatus = 0x02;
  state: CoreStateReply = {
    weight: 50,
    motorEngaged: false,
    trainingMode: TrainingMode.WeightTraining,
  };
  /** When false, the device answers a core-state read with an empty reply. */
  reportsState = true;
  /** Core-state reads seen since the last reset. */
  stateReads = 0;

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
    if (isHandshakeFinishWrite(data)) {
      this.answerHandshake();
      return;
    }
    if (isCoreStateRead(data)) {
      this.stateReads++;
      this.emitNotification(
        this.reportsState ? buildCoreStateReply(this.state) : encodeBulkParamResponse([])
      );
    }
  }

  private answerHandshake(): void {
    if (this.acceptance === 'silent') return;
    if (this.acceptance === 'refuse') {
      this.emitNotification(buildAcceptanceReport(this.refusalStatus));
      return;
    }
    if (this.acceptance === 'immediate') {
      this.emitNotification(buildAcceptanceReport());
      return;
    }
    setTimeout(() => this.emitNotification(buildAcceptanceReport()), this.acceptanceDelayMs);
  }

  countControlWrites(): number {
    return this.writes.filter((w) =>
      CONTROL_WRITES.some((c) => c.length === w.length && c.every((b, i) => b === w[i]))
    ).length;
  }
}

const device: Device = { id: 'device-vw403', name: 'VTR-VW4030', rssi: -55 };

async function flushAndAwait<T>(promise: Promise<T>): Promise<T> {
  while (true) {
    const settled = await Promise.race([
      promise.then((value) => ({ done: true as const, value })),
      Promise.resolve().then(() => ({ done: false as const })),
    ]);
    if (settled.done) return settled.value;
    await vi.advanceTimersByTimeAsync(100);
  }
}

describe('VoltraClient — connect waits for the device to accept', () => {
  let adapter: ScriptedDevice;
  let client: VoltraClient;

  beforeEach(() => {
    vi.useFakeTimers();
    adapter = new ScriptedDevice();
    client = new VoltraClient({ adapter });
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('connects when the device answers immediately', async () => {
    await flushAndAwait(client.connect(device));

    expect(client.connectionState).toBe('connected');
  });

  it('connects when the device takes seconds to answer, as on a first pairing', async () => {
    adapter.acceptance = 'delayed';

    await flushAndAwait(client.connect(device));

    expect(client.connectionState).toBe('connected');
  });

  it('rejects and stays disconnected when the device refuses', async () => {
    adapter.acceptance = 'refuse';

    await expect(flushAndAwait(client.connect(device))).rejects.toBeInstanceOf(ConnectionError);
    expect(client.connectionState).toBe('disconnected');
  });

  it('rejects and stays disconnected when the device never answers', async () => {
    adapter.acceptance = 'silent';

    await expect(flushAndAwait(client.connect(device))).rejects.toBeInstanceOf(ConnectionError);
    expect(client.connectionState).toBe('disconnected');
  });

  it('does not retry on its own after a refusal', async () => {
    adapter.acceptance = 'refuse';

    await expect(flushAndAwait(client.connect(device))).rejects.toBeInstanceOf(ConnectionError);
    await vi.advanceTimersByTimeAsync(60_000);

    const handshakes = adapter.writes.filter(isHandshakeFinishWrite);
    expect(handshakes).toHaveLength(1);
  });

  it('honours a shortened acceptance window', async () => {
    client.dispose();
    adapter = new ScriptedDevice();
    adapter.acceptance = 'delayed';
    adapter.acceptanceDelayMs = 5_000;
    client = new VoltraClient({ adapter, acceptanceTimeoutMs: 1_000 });

    await expect(flushAndAwait(client.connect(device))).rejects.toBeInstanceOf(ConnectionError);
  });

  it('writes no load, unload, weight or mode command during connection setup', async () => {
    await flushAndAwait(client.connect(device));

    expect(adapter.countControlWrites()).toBe(0);
  });

  it('refuses a control write while the acceptance is still pending', async () => {
    adapter.acceptance = 'delayed';
    const connecting = client.connect(device);

    // Past the auth and init delays, well short of the device's answer.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(client.connectionState).toBe('awaitingAcceptance');
    await expect(client.setWeight(50)).rejects.toThrow();

    await flushAndAwait(connecting);
  });

  it('accepts only the status the device sends when it accepted', async () => {
    adapter.acceptance = 'refuse';
    adapter.refusalStatus = ACCEPTANCE_STATUS_OK + 1;

    await expect(flushAndAwait(client.connect(device))).rejects.toBeInstanceOf(ConnectionError);
  });
});

describe('VoltraClient — control values are unknown until the device reports them', () => {
  let adapter: ScriptedDevice;
  let client: VoltraClient;

  beforeEach(() => {
    vi.useFakeTimers();
    adapter = new ScriptedDevice();
    client = new VoltraClient({ adapter });
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  it('reads core state back once the connection is accepted', async () => {
    await flushAndAwait(client.connect(device));

    expect(adapter.stateReads).toBe(1);
    expect(client.hasConfirmedState).toBe(true);
    expect(client.confirmedSettings.weight).toBe(50);
    expect(client.confirmedSettings.mode).toBe(TrainingMode.WeightTraining);
  });

  it('refuses control writes when the device answers the read with nothing', async () => {
    adapter.reportsState = false;

    await flushAndAwait(client.connect(device));

    expect(client.hasConfirmedState).toBe(false);
    await expect(client.setWeight(50)).rejects.toBeInstanceOf(DeviceStateUnknownError);
  });

  it('does not let an empty reply stand in for a cached value', async () => {
    await flushAndAwait(client.connect(device));
    expect(client.settings.weight).toBe(50);

    await flushAndAwait(client.disconnect());
    adapter.reportsState = false;
    await flushAndAwait(client.connect(device));

    // Last-known survives, but nothing about this connection is confirmed.
    expect(client.settings.weight).toBe(50);
    expect(client.confirmedSettings.weight).toBeUndefined();
    expect(client.hasConfirmedState).toBe(false);
  });

  it('exposes the new values after a reconnect to a device that changed', async () => {
    await flushAndAwait(client.connect(device));
    expect(client.confirmedSettings.weight).toBe(50);

    await flushAndAwait(client.disconnect());
    expect(client.confirmedSettings.weight).toBeUndefined();

    adapter.state = { weight: 90, motorEngaged: false, trainingMode: TrainingMode.Damper };
    await flushAndAwait(client.connect(device));

    expect(client.confirmedSettings.weight).toBe(90);
    expect(client.confirmedSettings.mode).toBe(TrainingMode.Damper);
  });

  it('clears the refusal after an explicit refresh', async () => {
    adapter.reportsState = false;
    await flushAndAwait(client.connect(device));
    await expect(client.setWeight(50)).rejects.toBeInstanceOf(DeviceStateUnknownError);

    adapter.reportsState = true;
    await flushAndAwait(client.refreshDeviceState());

    expect(client.hasConfirmedState).toBe(true);
    await expect(flushAndAwait(client.setWeight(50))).resolves.toBeUndefined();
  });
});
