/**
 * Tests for SDK-level mock activation.
 *
 * Covers the two activation sources (VOLTRA_MOCK env var + the programmatic
 * setMockActivation() flag) and the end-to-end effect on VoltraManager
 * platform auto-detection: an activated, auto-detected manager selects the
 * mock adapter and discovers the simulated device, while an explicit
 * platform/adapterFactory still takes precedence.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isMockActivated, setMockActivation } from '../mock-activation';
import { VoltraManager } from '../voltra-manager';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';

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

describe('mock-activation', () => {
  const originalEnv = process.env.VOLTRA_MOCK;

  afterEach(() => {
    // Reset both sources so tests don't leak activation state.
    setMockActivation(undefined);
    if (originalEnv === undefined) {
      delete process.env.VOLTRA_MOCK;
    } else {
      process.env.VOLTRA_MOCK = originalEnv;
    }
  });

  describe('isMockActivated()', () => {
    it('is false with no env var and no programmatic flag', () => {
      delete process.env.VOLTRA_MOCK;
      expect(isMockActivated()).toBe(false);
    });

    it.each(['1', 'true', 'TRUE', 'yes', 'on', ' true '])(
      'is true for truthy VOLTRA_MOCK=%j',
      (value) => {
        process.env.VOLTRA_MOCK = value;
        expect(isMockActivated()).toBe(true);
      }
    );

    it.each(['0', 'false', 'no', 'off', ''])('is false for non-truthy VOLTRA_MOCK=%j', (value) => {
      process.env.VOLTRA_MOCK = value;
      expect(isMockActivated()).toBe(false);
    });

    it('programmatic true overrides an absent env var', () => {
      delete process.env.VOLTRA_MOCK;
      setMockActivation(true);
      expect(isMockActivated()).toBe(true);
    });

    it('programmatic false overrides a truthy env var', () => {
      process.env.VOLTRA_MOCK = '1';
      setMockActivation(false);
      expect(isMockActivated()).toBe(false);
    });

    it('clearing the programmatic flag defers back to the env var', () => {
      process.env.VOLTRA_MOCK = '1';
      setMockActivation(false);
      expect(isMockActivated()).toBe(false);

      setMockActivation(undefined);
      expect(isMockActivated()).toBe(true);
    });
  });

  describe('VoltraManager auto-detection', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      delete process.env.VOLTRA_MOCK;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('selects the mock adapter when activation is set', async () => {
      setMockActivation(true);
      const manager = new VoltraManager();

      const devices = await flushAndAwait(manager.scan({ timeout: 100 }));

      expect(devices).toHaveLength(1);
      expect(devices[0].id).toBe('mock-voltra-001');
      expect(devices[0].name).toBe('VTR-Mock');

      manager.dispose();
    });

    it('honors an explicit adapterFactory even when mock is activated', async () => {
      setMockActivation(true);
      const explicit: Device = { id: 'device-explicit', name: 'VTR-EXPLICIT', rssi: -50 };
      const manager = new VoltraManager({
        adapterFactory: () => new ExplicitAdapter([explicit]),
      });

      const devices = await flushAndAwait(manager.scan({ timeout: 100 }));

      expect(devices).toEqual([explicit]);

      manager.dispose();
    });
  });
});

class ExplicitAdapter extends BaseBLEAdapter {
  constructor(private readonly knownDevices: Device[]) {
    super();
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

  async write(_data: Uint8Array): Promise<void> {}
}
