/**
 * MockBLEAdapter Device Parameter Simulation Tests
 *
 * Verifies configurable device identity, battery drain during active sessions,
 * RSSI noise simulation, and device info response accuracy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockBLEAdapter } from '../mock';
import { DEVICE_PARAM_DEFAULTS, RSSI_NOISE_STD_DEV } from '../mock/types';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// Helpers
// =============================================================================

async function connectAdapter(adapter: MockBLEAdapter): Promise<void> {
  const p = adapter.connect('mock-voltra-001');
  vi.advanceTimersByTime(0);
  await p;
}

function tickSamples(n: number): void {
  for (let i = 0; i < n; i++) {
    vi.advanceTimersByTime(91);
  }
}

// =============================================================================
// Default Device Parameters
// =============================================================================

describe('MockBLEAdapter device parameters', () => {
  describe('defaults', () => {
    it('populates all device params with sensible defaults', () => {
      const adapter = new MockBLEAdapter();
      const params = adapter.getDeviceParams();

      expect(params.serialNumber).toBe(DEVICE_PARAM_DEFAULTS.serialNumber);
      expect(params.firmwareVersion).toBe(DEVICE_PARAM_DEFAULTS.firmwareVersion);
      expect(params.hardwareVersion).toBe(DEVICE_PARAM_DEFAULTS.hardwareVersion);
      expect(params.modelName).toBe(DEVICE_PARAM_DEFAULTS.modelName);
      expect(params.batteryLevel).toBe(DEVICE_PARAM_DEFAULTS.batteryLevel);
    });

    it('scan returns RSSI near the default base value', async () => {
      const adapter = new MockBLEAdapter({ scanDelayMs: 0 });

      const rssiValues: number[] = [];
      for (let i = 0; i < 500; i++) {
        const scanPromise = adapter.scan(5);
        vi.advanceTimersByTime(0);
        const devices = await scanPromise;
        rssiValues.push(devices[0].rssi!);
      }

      // With stddev=5 and 500 samples, standard error ~0.22, so ±2 is very safe.
      // Previously n=50 with toBeCloseTo(_, 0) (±0.5) flaked at ~50%.
      const mean = rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length;
      expect(mean).toBeGreaterThan(DEVICE_PARAM_DEFAULTS.rssi - 2);
      expect(mean).toBeLessThan(DEVICE_PARAM_DEFAULTS.rssi + 2);
    });
  });

  // ===========================================================================
  // Custom Device Parameters
  // ===========================================================================

  describe('custom overrides', () => {
    it('overrides all device identity fields', () => {
      const adapter = new MockBLEAdapter({
        device: {
          serialNumber: 'VLT-001',
          firmwareVersion: '2.1.0',
          hardwareVersion: '1.0',
          modelName: 'Voltra Pro',
          batteryLevel: 85,
          rssi: -65,
        },
      });

      const params = adapter.getDeviceParams();
      expect(params.serialNumber).toBe('VLT-001');
      expect(params.firmwareVersion).toBe('2.1.0');
      expect(params.hardwareVersion).toBe('1.0');
      expect(params.modelName).toBe('Voltra Pro');
      expect(params.batteryLevel).toBe(85);
    });

    it('partial overrides merge with defaults', () => {
      const adapter = new MockBLEAdapter({
        device: { serialNumber: 'VLT-CUSTOM' },
      });

      const params = adapter.getDeviceParams();
      expect(params.serialNumber).toBe('VLT-CUSTOM');
      expect(params.firmwareVersion).toBe(DEVICE_PARAM_DEFAULTS.firmwareVersion);
      expect(params.modelName).toBe(DEVICE_PARAM_DEFAULTS.modelName);
    });
  });

  // ===========================================================================
  // Battery Simulation
  // ===========================================================================

  describe('battery drain', () => {
    it('drains during active session (~1% per minute)', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        device: { batteryLevel: 100 },
      });

      await connectAdapter(adapter);

      // Advance 1 minute
      vi.advanceTimersByTime(60_000);

      const level = adapter.getBatteryLevel();
      expect(level).toBeCloseTo(99, 0);
      expect(level).toBeLessThan(100);

      await adapter.disconnect();
    });

    it('stops draining after disconnect', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        device: { batteryLevel: 100 },
      });

      await connectAdapter(adapter);
      vi.advanceTimersByTime(60_000);
      await adapter.disconnect();

      const levelAtDisconnect = adapter.getBatteryLevel();

      // Wait another minute — battery should not drain further
      vi.advanceTimersByTime(60_000);
      expect(adapter.getBatteryLevel()).toBe(levelAtDisconnect);
    });

    it('never goes below 0%', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        device: { batteryLevel: 1 },
      });

      await connectAdapter(adapter);
      // Drain well past 0%
      vi.advanceTimersByTime(120_000);

      expect(adapter.getBatteryLevel()).toBe(0);

      await adapter.disconnect();
    });

    it('stable when not connected', () => {
      const adapter = new MockBLEAdapter({
        device: { batteryLevel: 50 },
      });

      vi.advanceTimersByTime(300_000);
      expect(adapter.getBatteryLevel()).toBe(50);
    });

    it('getDeviceParams reflects current battery level', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        device: { batteryLevel: 80 },
      });

      await connectAdapter(adapter);
      vi.advanceTimersByTime(60_000);

      const params = adapter.getDeviceParams();
      expect(params.batteryLevel).toBeLessThan(80);
      expect(params.batteryLevel).toBeCloseTo(79, 0);

      await adapter.disconnect();
    });
  });

  // ===========================================================================
  // RSSI Noise
  // ===========================================================================

  describe('RSSI simulation', () => {
    it('returns values within expected noise range', () => {
      const adapter = new MockBLEAdapter({
        device: { rssi: -70 },
      });

      const samples: number[] = [];
      for (let i = 0; i < 100; i++) {
        samples.push(adapter.getRssi());
      }

      // All samples should be within ~4 std devs of base (very high probability)
      const maxDeviation = RSSI_NOISE_STD_DEV * 4;
      for (const s of samples) {
        expect(s).toBeGreaterThan(-70 - maxDeviation);
        expect(s).toBeLessThan(-70 + maxDeviation);
      }
    });

    it('noise has approximate gaussian distribution (mean near base)', () => {
      const adapter = new MockBLEAdapter({
        device: { rssi: -50 },
      });

      const samples: number[] = [];
      for (let i = 0; i < 500; i++) {
        samples.push(adapter.getRssi());
      }

      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      // With stddev=5 and 500 samples, standard error ~0.22, so ±2 is very safe
      expect(mean).toBeGreaterThan(-52);
      expect(mean).toBeLessThan(-48);
    });

    it('scan uses configured RSSI base with noise', async () => {
      const adapter = new MockBLEAdapter({
        scanDelayMs: 0,
        device: { rssi: -80 },
      });

      const scanPromise = adapter.scan(5);
      vi.advanceTimersByTime(0);
      const devices = await scanPromise;

      // RSSI should be in the neighborhood of -80
      expect(devices[0].rssi).not.toBeNull();
      expect(devices[0].rssi!).toBeGreaterThan(-100);
      expect(devices[0].rssi!).toBeLessThan(-60);
    });
  });

  // ===========================================================================
  // Device Info Response
  // ===========================================================================

  describe('device info matches config', () => {
    it('getDeviceParams returns all configured values', () => {
      const adapter = new MockBLEAdapter({
        device: {
          serialNumber: 'VLT-TEST-42',
          firmwareVersion: '3.0.0-beta',
          hardwareVersion: '2.0',
          modelName: 'Voltra Elite',
          batteryLevel: 73,
          rssi: -55,
        },
      });

      const params = adapter.getDeviceParams();
      expect(params.serialNumber).toBe('VLT-TEST-42');
      expect(params.firmwareVersion).toBe('3.0.0-beta');
      expect(params.hardwareVersion).toBe('2.0');
      expect(params.modelName).toBe('Voltra Elite');
      expect(params.batteryLevel).toBe(73);
    });
  });

  // ===========================================================================
  // Backward Compatibility
  // ===========================================================================

  describe('backward compatibility', () => {
    it('adapter without device config works identically to before', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0, repsPerSet: 2 });
      const notifications: Uint8Array[] = [];
      adapter.onNotification((data) => notifications.push(data));

      await connectAdapter(adapter);
      tickSamples(32);
      await adapter.disconnect();

      expect(notifications.length).toBeGreaterThan(0);
      expect(adapter.getConnectionState()).toBe('disconnected');
    });
  });
});
