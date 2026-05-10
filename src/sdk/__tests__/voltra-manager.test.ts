/**
 * Focused unit tests for VoltraManager.
 *
 * Covers connect/disconnect/reconnect/scan paths that aren't already
 * exercised by multi-device-routing.test.ts. The goal here is to lift
 * function coverage on voltra-manager.ts above the 60% global threshold
 * without changing production semantics.
 *
 * Note on scan-adapter handoff: the `this.scanAdapter` reuse branch in
 * `connect()` is platform-agnostic. On web the scanAdapter holds a
 * BluetoothDevice reference from requestDevice(); on node it holds the
 * selectedDevice populated during scan. Both must be reused on the first
 * connect after a scan or `adapter.connect()` will throw. The block
 * below exercises both platforms.
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

  /**
   * Test helper: simulate an unexpected adapter-level disconnect
   * (gattserverdisconnected / noble 'disconnect' event). Flips connection
   * state to 'disconnected' WITHOUT going through the public disconnect()
   * — this is the path setupDisconnectMonitor watches and routes through
   * VoltraClient.handleUnexpectedDisconnect().
   */
  simulateUnexpectedDisconnect(): void {
    this.setConnectionState('disconnected');
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

  describe('Phase 6 wrapper firing under manager auto-dispose', () => {
    /**
     * Regression: manager.handleClientEvent listens to the client's bare
     * `'disconnected'` emit and synchronously calls client.dispose(), which
     * clears all wrapper listeners. If the client fires
     * notifyConnectionLossEvent AFTER the bare emit, the listener is gone
     * and the wrapper silently drops. Verified on hardware 2026-05-10
     * (HARDWARE-A summary, Test 2b). Fix: fire wrapper BEFORE the bare
     * emit in flipToDisconnected + handleUnexpectedDisconnect.
     */
    it('fires onConnectionLossEvent on adapter-level disconnect through manager path', async () => {
      const client = await flushAndAwait(manager.connect(deviceA));
      const adapter = createdAdapters[createdAdapters.length - 1];

      const losses: { seq: number; ts: number; payload: unknown }[] = [];
      client.onConnectionLossEvent((e) => losses.push(e));

      adapter.simulateUnexpectedDisconnect();
      // setConnectionState callbacks are synchronous, but
      // handleUnexpectedDisconnect awaits one microtask before firing.
      await flushAndAwait(Promise.resolve());

      expect(losses).toHaveLength(1);
      expect((losses[0].payload as { reason: string }).reason).toBe('gatt_disconnect');
      expect(typeof losses[0].seq).toBe('number');
      expect(typeof losses[0].ts).toBe('number');
      // Manager has disposed the client by the time we observe — but the
      // wrapper still fired BEFORE that happened.
      expect(manager.connectedCount).toBe(0);
    });

    it('fires onConnectionLossEvent on write-failure path through manager', async () => {
      const client = await flushAndAwait(manager.connect(deviceA));
      const adapter = createdAdapters[createdAdapters.length - 1];

      const losses: { seq: number; ts: number; payload: unknown }[] = [];
      client.onConnectionLossEvent((e) => losses.push(e));

      // Force write to throw — simulates a write failure with link
      // still reporting alive (the Bug 30 scenario).
      adapter.write = async () => {
        throw new Error('Write failed: simulated link death');
      };

      await expect(client.setDamperLevel(2)).rejects.toThrow();

      // The KEY invariant under test: the wrapper fires through the
      // manager-attached path, despite manager auto-dispose on the bare
      // 'disconnected' emit. Reason field may resolve as 'write_failure'
      // OR 'gatt_disconnect' depending on internal cascade order; either
      // is an actionable signal for the consumer.
      expect(losses.length).toBeGreaterThanOrEqual(1);
      const reason = (losses[0].payload as { reason: string }).reason;
      expect(['write_failure', 'gatt_disconnect']).toContain(reason);
      expect(typeof losses[0].seq).toBe('number');
      expect(typeof losses[0].ts).toBe('number');
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

  // Regression tests for the bug introduced in 0.4.2 where the scan-adapter
  // handoff was scoped to `platform === 'web'`. On node, the freshly-built
  // factory adapter has no `selectedDevice` (only the scan callback in
  // node.ts populates it), so `adapter.connect(deviceId)` would throw
  // "No device selected. Call scan() first." every time. Removing the
  // platform gate restores the working semantics: reuse scanAdapter for
  // the first post-scan connect on every platform.
  describe('node-platform scan-adapter reuse (regression: 0.4.2 -> 0.6.1)', () => {
    it('scan + connect on node reuses scanAdapter (factory called once)', async () => {
      // `manager` from the outer beforeEach is configured with platform='node'.
      await flushAndAwait(manager.scan({ timeout: 100, filterVoltra: false }));
      expect(createdAdapters.length).toBe(1);

      const client = await flushAndAwait(manager.connect(deviceA));

      // Factory still called exactly once — the scanAdapter was reused.
      expect(createdAdapters.length).toBe(1);
      expect(client.getAdapter()).toBe(createdAdapters[0]);
      // After handoff scanAdapter is nulled.
      expect(manager.getAdapter()).toBeNull();
    });

    it('second connect without a fresh scan builds a new adapter', async () => {
      await flushAndAwait(manager.scan({ timeout: 100, filterVoltra: false }));
      await flushAndAwait(manager.connect(deviceA));
      expect(createdAdapters.length).toBe(1);

      // No re-scan: connecting to a different device must allocate a new adapter.
      const clientB = await flushAndAwait(manager.connect(deviceB));

      expect(createdAdapters.length).toBe(2);
      expect(clientB.getAdapter()).toBe(createdAdapters[1]);
    });

    it('scan + connect + scan + connect calls factory exactly twice', async () => {
      await flushAndAwait(manager.scan({ timeout: 100, filterVoltra: false }));
      await flushAndAwait(manager.connect(deviceA));
      // First scan adapter consumed by the first connect.
      expect(createdAdapters.length).toBe(1);

      // Second scan rebuilds scanAdapter (factory call #2)…
      await flushAndAwait(manager.scan({ timeout: 100, filterVoltra: false }));
      expect(createdAdapters.length).toBe(2);

      // …and the next connect reuses it instead of allocating a third adapter.
      const clientB = await flushAndAwait(manager.connect(deviceB));
      expect(createdAdapters.length).toBe(2);
      expect(clientB.getAdapter()).toBe(createdAdapters[1]);
    });
  });
});
