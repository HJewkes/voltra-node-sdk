/**
 * Focused unit tests for VoltraManager.
 *
 * Covers connect/disconnect/reconnect/scan paths that aren't already
 * exercised by multi-device-routing.test.ts. The goal here is to lift
 * function coverage on voltra-manager.ts above the 60% global threshold
 * without changing production semantics.
 *
 * Note on web-platform handoff: the `platform === 'web' && this.scanAdapter`
 * branch is exercised here by injecting a custom adapterFactory and
 * pre-seeding scanAdapter via a scan() call before connect. The web
 * BLE peer module isn't loaded — only the boolean flag matters for
 * the handoff branch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraManager } from '../voltra-manager';

class RecordingAdapter extends BaseBLEAdapter {
  readonly writes: Uint8Array[] = [];
  private knownDevices: Device[];

  constructor(devices: Device[]) {
    super();
    this.knownDevices = devices;
  }

  async scan(_timeout: number): Promise<Device[]> {
    return this.knownDevices;
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

const deviceA: Device = { id: 'device-a', name: 'VTR-AAAAAA', rssi: -50 };
const deviceB: Device = { id: 'device-b', name: 'VTR-BBBBBB', rssi: -60 };

/**
 * Awaits a promise while flushing pending fake timers.
 * VoltraClient.connect resolves only after auth + init delays elapse.
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

describe('VoltraManager', () => {
  let manager: VoltraManager;
  let createdAdapters: RecordingAdapter[];

  beforeEach(() => {
    vi.useFakeTimers();
    createdAdapters = [];
    manager = new VoltraManager({
      platform: 'node',
      adapterFactory: () => {
        const a = new RecordingAdapter([deviceA, deviceB]);
        createdAdapters.push(a);
        return a;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('scan()', () => {
    it('returns discovered devices and toggles isScanning', async () => {
      const scanPromise = manager.scan({ timeout: 100, filterVoltra: false });
      expect(manager.isScanning).toBe(true);

      const devices = await flushAndAwait(scanPromise);

      expect(manager.isScanning).toBe(false);
      expect(devices).toEqual([deviceA, deviceB]);
      expect(manager.devices).toEqual([deviceA, deviceB]);
    });

    it('emits scanStarted and scanStopped events', async () => {
      const events: string[] = [];
      manager.subscribe((e) => events.push(e.type));

      await flushAndAwait(manager.scan({ timeout: 100, filterVoltra: false }));

      expect(events).toContain('scanStarted');
      expect(events).toContain('scanStopped');
    });

    it('reuses scanAdapter across multiple scans', async () => {
      await flushAndAwait(manager.scan({ timeout: 100, filterVoltra: false }));
      const adapterAfterFirst = manager.getAdapter();

      await flushAndAwait(manager.scan({ timeout: 100, filterVoltra: false }));
      const adapterAfterSecond = manager.getAdapter();

      expect(adapterAfterSecond).toBe(adapterAfterFirst);
    });
  });

  describe('disconnect()', () => {
    it('removes the client from the connected map', async () => {
      const client = await flushAndAwait(manager.connect(deviceA));
      expect(manager.connectedCount).toBe(1);
      expect(manager.getClient(deviceA.id)).toBe(client);

      await manager.disconnect(deviceA.id);

      expect(manager.connectedCount).toBe(0);
      expect(manager.getClient(deviceA.id)).toBeUndefined();
      expect(manager.isConnected(deviceA.id)).toBe(false);
    });

    it('emits deviceDisconnected event', async () => {
      await flushAndAwait(manager.connect(deviceA));

      const disconnected: string[] = [];
      manager.onDeviceDisconnected((id) => disconnected.push(id));

      await manager.disconnect(deviceA.id);

      expect(disconnected).toEqual([deviceA.id]);
    });

    it('is a silent no-op when called with an unknown deviceId', async () => {
      // No connection has been made — should not throw and should not emit.
      const events: string[] = [];
      manager.subscribe((e) => events.push(e.type));

      await expect(manager.disconnect('does-not-exist')).resolves.toBeUndefined();

      expect(events).not.toContain('deviceDisconnected');
      expect(manager.connectedCount).toBe(0);
    });
  });

  describe('reconnect after disconnect', () => {
    it('builds a fresh adapter and produces an independent client', async () => {
      const first = await flushAndAwait(manager.connect(deviceA));
      const firstAdapter = first.getAdapter();

      await manager.disconnect(deviceA.id);
      expect(manager.isConnected(deviceA.id)).toBe(false);

      const second = await flushAndAwait(manager.connect(deviceA));
      const secondAdapter = second.getAdapter();

      expect(second).not.toBe(first);
      expect(secondAdapter).not.toBe(firstAdapter);
      expect(manager.connectedCount).toBe(1);
      expect(second.isConnected).toBe(true);
    });
  });

  describe('connectByName()', () => {
    it('connects when a device matches by contains (default)', async () => {
      const client = await flushAndAwait(manager.connectByName('AAAAAA'));

      expect(client.connectedDeviceId).toBe(deviceA.id);
      expect(manager.isConnected(deviceA.id)).toBe(true);
    });

    it('connects on exact match', async () => {
      const client = await flushAndAwait(
        manager.connectByName('VTR-BBBBBB', { matchMode: 'exact' })
      );
      expect(client.connectedDeviceId).toBe(deviceB.id);
    });

    it('throws when no device matches', async () => {
      await expect(
        flushAndAwait(manager.connectByName('NOPE', { matchMode: 'exact' }))
      ).rejects.toThrow(/No Voltra device found/);
    });
  });

  describe('connectFirst()', () => {
    it('connects to the first discovered device', async () => {
      const client = await flushAndAwait(manager.connectFirst({ filterVoltra: false }));
      expect(client.connectedDeviceId).toBe(deviceA.id);
    });

    it('throws when scan returns no devices', async () => {
      const emptyManager = new VoltraManager({
        platform: 'node',
        adapterFactory: () => new RecordingAdapter([]),
      });
      await expect(
        flushAndAwait(emptyManager.connectFirst({ filterVoltra: false }))
      ).rejects.toThrow(/No Voltra devices found/);
    });
  });

  describe('disposal', () => {
    it('rejects new operations after dispose()', async () => {
      manager.dispose();
      await expect(manager.scan()).rejects.toThrow(/disposed/);
      await expect(manager.connect(deviceA)).rejects.toThrow(/disposed/);
    });

    it('is idempotent', () => {
      manager.dispose();
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  describe('web-platform scan-adapter handoff', () => {
    it('adopts the scanAdapter for the first connect on web, then nulls it', async () => {
      const adapters: RecordingAdapter[] = [];
      const webManager = new VoltraManager({
        platform: 'web',
        adapterFactory: () => {
          const a = new RecordingAdapter([deviceA, deviceB]);
          adapters.push(a);
          return a;
        },
      });

      await flushAndAwait(webManager.scan({ timeout: 100, filterVoltra: false }));
      const scanAdapter = webManager.getAdapter();
      expect(scanAdapter).not.toBeNull();

      const client = await flushAndAwait(webManager.connect(deviceA));

      // First connect on web reuses the scan adapter.
      expect(client.getAdapter()).toBe(scanAdapter);
      // After handoff, the manager nulls scanAdapter so the next connect
      // builds a fresh one (and on real web triggers a new picker).
      expect(webManager.getAdapter()).toBeNull();
      // Only the scan-adapter has been built so far.
      expect(adapters.length).toBe(1);

      // A second connect to a different device must build a new adapter.
      const clientB = await flushAndAwait(webManager.connect(deviceB));
      expect(clientB.getAdapter()).not.toBe(scanAdapter);
      expect(adapters.length).toBe(2);
    });
  });
});
