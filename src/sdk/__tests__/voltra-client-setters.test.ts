/**
 * Unit tests for the 0.6.0 mode-config setters on VoltraClient.
 *
 * Each setter writes its expected protocol bytes to the adapter when the
 * client is connected, throws InvalidSettingError on out-of-range input,
 * and throws NotConnectedError when called without an active connection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { InvalidSettingError, NotConnectedError } from '../../errors';
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

/**
 * VoltraClient.connect resolves only after auth + init delays elapse.
 * Flush fake timers while awaiting the connect promise.
 */
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

/** Find the most recent write that matches the expected payload. */
function lastMatchingWrite(adapter: RecordingAdapter, expected: Uint8Array): Uint8Array | null {
  for (let i = adapter.writes.length - 1; i >= 0; i--) {
    const w = adapter.writes[i];
    if (w.length === expected.length && w.every((b, j) => b === expected[j])) {
      return w;
    }
  }
  return null;
}

describe('VoltraClient — 0.6.0 mode-config setters', () => {
  let adapter: RecordingAdapter;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new RecordingAdapter();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
    // Clear writes from auth + init so individual tests start clean.
    adapter.writes.length = 0;
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  describe('setDamperLevel', () => {
    it('writes the expected bytes for a valid level', async () => {
      await client.setDamperLevel(0);
      const expected = hexToBytes(protocol.commands.damperLevel['0']);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('throws InvalidSettingError for an out-of-range level', async () => {
      await expect(client.setDamperLevel(99)).rejects.toBeInstanceOf(InvalidSettingError);
    });

    it('throws NotConnectedError when the client is not connected', async () => {
      const stand = new VoltraClient({ adapter: new RecordingAdapter() });
      await expect(stand.setDamperLevel(3)).rejects.toBeInstanceOf(NotConnectedError);
    });
  });

  describe('setAssistMode', () => {
    it('writes the expected bytes for "on"', async () => {
      await client.setAssistMode('on');
      const expected = hexToBytes(protocol.commands.assistMode.on);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('writes different bytes for "off" vs "on"', async () => {
      await client.setAssistMode('off');
      const offBytes = adapter.writes[adapter.writes.length - 1];
      adapter.writes.length = 0;
      await client.setAssistMode('on');
      const onBytes = adapter.writes[adapter.writes.length - 1];
      expect(offBytes).not.toEqual(onBytes);
    });
  });

  describe('setBandMaxForce', () => {
    it('writes the expected bytes for 15 lbs', async () => {
      await client.setBandMaxForce(15);
      const expected = hexToBytes(protocol.commands.bandMaxForce['15']);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('throws InvalidSettingError below the supported range', async () => {
      await expect(client.setBandMaxForce(5)).rejects.toBeInstanceOf(InvalidSettingError);
    });
  });

  describe('setIsokineticTargetSpeed', () => {
    it('writes the expected bytes for 100 mm/s', async () => {
      await client.setIsokineticTargetSpeed(100);
      const expected = hexToBytes(protocol.commands.isokineticTargetSpeed['100']);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('throws InvalidSettingError for an off-step value', async () => {
      await expect(client.setIsokineticTargetSpeed(105)).rejects.toBeInstanceOf(
        InvalidSettingError
      );
    });
  });

  describe('setIsokineticEccMode', () => {
    it('writes the expected bytes for "constant"', async () => {
      await client.setIsokineticEccMode('constant');
      const expected = hexToBytes(protocol.commands.isokineticEccMode.constant);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });
  });

  describe('setIsokineticEccSpeedLimit', () => {
    it('writes the expected bytes for 0 (auto)', async () => {
      await client.setIsokineticEccSpeedLimit(0);
      const expected = hexToBytes(protocol.commands.isokineticEccSpeedLimit['0']);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('throws InvalidSettingError for off-step input', async () => {
      await expect(client.setIsokineticEccSpeedLimit(7)).rejects.toBeInstanceOf(
        InvalidSettingError
      );
    });
  });

  describe('setIsokineticEccConstWeight', () => {
    it('writes the expected bytes for 100 lbs', async () => {
      await client.setIsokineticEccConstWeight(100);
      const expected = hexToBytes(protocol.commands.isokineticEccConstWeight['100']);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('throws InvalidSettingError above the supported range', async () => {
      await expect(client.setIsokineticEccConstWeight(201)).rejects.toBeInstanceOf(
        InvalidSettingError
      );
    });
  });

  describe('setIsokineticEccOverloadWeight', () => {
    it('writes the expected bytes for 50 lbs', async () => {
      await client.setIsokineticEccOverloadWeight(50);
      const expected = hexToBytes(protocol.commands.isokineticEccOverloadWeight['50']);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('throws InvalidSettingError above the supported range', async () => {
      await expect(client.setIsokineticEccOverloadWeight(201)).rejects.toBeInstanceOf(
        InvalidSettingError
      );
    });
  });

  describe('getAvailable* helpers', () => {
    it('exposes the expected ranges', () => {
      expect(client.getAvailableDamperLevels()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

      const bandRange = client.getAvailableBandMaxForce();
      expect(bandRange[0]).toBe(15);
      expect(bandRange[bandRange.length - 1]).toBe(70);

      const speeds = client.getAvailableIsokineticTargetSpeeds();
      expect(speeds[0]).toBe(0);
      expect(speeds[speeds.length - 1]).toBe(2000);

      const limits = client.getAvailableIsokineticEccSpeedLimits();
      expect(limits[0]).toBe(0);
      expect(limits[limits.length - 1]).toBe(2000);

      expect(client.getAvailableIsokineticEccConstWeights().length).toBe(201);
      expect(client.getAvailableIsokineticEccOverloadWeights().length).toBe(201);
    });
  });

  // ===========================================================================
  // QoL Setters (@experimental, added in 0.6.0)
  // ===========================================================================

  describe('setTelemetryRate', () => {
    it('writes the expected bytes for a valid rate', async () => {
      await client.setTelemetryRate(10);
      const expected = hexToBytes(protocol.commands.telemetryRate['10']);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('throws InvalidSettingError for an out-of-range rate', async () => {
      await expect(client.setTelemetryRate(999)).rejects.toBeInstanceOf(InvalidSettingError);
    });

    it('throws NotConnectedError when the client is not connected', async () => {
      const stand = new VoltraClient({ adapter: new RecordingAdapter() });
      await expect(stand.setTelemetryRate(10)).rejects.toBeInstanceOf(NotConnectedError);
    });
  });

  describe('setTelemetrySubscribe', () => {
    it('writes the expected bytes for "all"', async () => {
      await client.setTelemetrySubscribe('all');
      const expected = hexToBytes(protocol.commands.telemetrySubscribe.all);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('writes different bytes for "none" vs "all"', async () => {
      await client.setTelemetrySubscribe('none');
      const noneBytes = adapter.writes[adapter.writes.length - 1];
      adapter.writes.length = 0;
      await client.setTelemetrySubscribe('all');
      const allBytes = adapter.writes[adapter.writes.length - 1];
      expect(noneBytes).not.toEqual(allBytes);
    });
  });

  describe('setCableTrigger', () => {
    it('writes the expected bytes for "open"', async () => {
      await client.setCableTrigger('open');
      const expected = hexToBytes(protocol.commands.cableTrigger.open);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('writes different bytes for "open" vs "close"', async () => {
      await client.setCableTrigger('open');
      const openBytes = adapter.writes[adapter.writes.length - 1];
      adapter.writes.length = 0;
      await client.setCableTrigger('close');
      const closeBytes = adapter.writes[adapter.writes.length - 1];
      expect(openBytes).not.toEqual(closeBytes);
    });
  });

  describe('setResistanceExperience', () => {
    it('writes the expected bytes for "intense"', async () => {
      await client.setResistanceExperience('intense');
      const expected = hexToBytes(protocol.commands.resistanceExperience.intense);
      expect(lastMatchingWrite(adapter, expected)).not.toBeNull();
    });

    it('writes different bytes for "intense" vs "standard"', async () => {
      await client.setResistanceExperience('intense');
      const intenseBytes = adapter.writes[adapter.writes.length - 1];
      adapter.writes.length = 0;
      await client.setResistanceExperience('standard');
      const standardBytes = adapter.writes[adapter.writes.length - 1];
      expect(intenseBytes).not.toEqual(standardBytes);
    });
  });
});
