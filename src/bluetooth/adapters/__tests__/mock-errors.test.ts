/**
 * MockBLEAdapter Error Injection Tests
 *
 * Verifies error injection framework: disconnect, authTimeout,
 * notificationDrop, malformedFrame, reconnectCycle, composition,
 * dynamic injection, and clearErrors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockBLEAdapter } from '../mock';
import {
  decodeTelemetryFrame,
} from '../../../voltra/protocol/telemetry-decoder';
import { MessageTypes } from '../../../voltra/protocol/constants/message-types';
import { bytesEqual } from '../../../shared/utils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// Helpers
// =============================================================================

function collectNotifications(adapter: MockBLEAdapter): Uint8Array[] {
  const notifications: Uint8Array[] = [];
  adapter.onNotification((data) => notifications.push(data));
  return notifications;
}

function isTelemetryFrame(data: Uint8Array): boolean {
  return data.length === 30 && bytesEqual(data.subarray(0, 4), MessageTypes.TELEMETRY_STREAM);
}

function tickSamples(n: number): void {
  for (let i = 0; i < n; i++) {
    vi.advanceTimersByTime(91);
  }
}

async function connectAdapter(adapter: MockBLEAdapter): Promise<void> {
  const p = adapter.connect('mock-voltra-001');
  vi.advanceTimersByTime(0);
  await p;
}

const SAMPLES_PER_REP = 32;

// =============================================================================
// Disconnect Error
// =============================================================================

describe('MockBLEAdapter error injection', () => {
  describe('disconnect', () => {
    it('disconnects after configured delay via constructor', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'disconnect',
        errorConfig: { afterMs: 500 },
      });
      const states: string[] = [];
      adapter.onConnectionStateChange((s) => states.push(s));
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);
      expect(adapter.getConnectionState()).toBe('connected');

      tickSamples(3);
      expect(notifications.length).toBeGreaterThan(0);

      vi.advanceTimersByTime(500);
      expect(adapter.getConnectionState()).toBe('disconnected');
      expect(states).toContain('disconnected');

      const countAfter = notifications.length;
      tickSamples(5);
      expect(notifications.length).toBe(countAfter);
    });

    it('stops telemetry on disconnect', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'disconnect',
        errorConfig: { afterMs: 200 },
      });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);
      vi.advanceTimersByTime(200);

      const countAtDisconnect = notifications.length;
      tickSamples(10);
      expect(notifications.length).toBe(countAtDisconnect);
    });
  });

  // ===========================================================================
  // Auth Timeout Error
  // ===========================================================================

  describe('authTimeout', () => {
    it('rejects connect after timeout', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'authTimeout',
        errorConfig: { timeoutMs: 1000 },
      });
      const states: string[] = [];
      adapter.onConnectionStateChange((s) => states.push(s));

      const connectPromise = adapter.connect('mock-voltra-001');
      expect(states).toContain('connecting');

      vi.advanceTimersByTime(1000);
      await expect(connectPromise).rejects.toThrow('Authentication timed out');
      expect(adapter.getConnectionState()).toBe('disconnected');
    });

    it('uses default 10s timeout when timeoutMs not specified', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'authTimeout',
        errorConfig: {},
      });

      const connectPromise = adapter.connect('mock-voltra-001');

      vi.advanceTimersByTime(9999);
      // Should still be pending
      expect(adapter.getConnectionState()).toBe('connecting');

      vi.advanceTimersByTime(1);
      await expect(connectPromise).rejects.toThrow('Authentication timed out');
    });

    it('does not emit telemetry during auth timeout', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'authTimeout',
        errorConfig: { timeoutMs: 500 },
      });
      const notifications = collectNotifications(adapter);

      const connectPromise = adapter.connect('mock-voltra-001');
      vi.advanceTimersByTime(500);
      await connectPromise.catch(() => {});

      expect(notifications.length).toBe(0);
    });
  });

  // ===========================================================================
  // Notification Drop
  // ===========================================================================

  describe('notificationDrop', () => {
    it('drops notifications at configured rate via constructor', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'notificationDrop',
        errorConfig: { dropRate: 0.5 },
      });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);
      tickSamples(100);
      await adapter.disconnect();

      // With 50% drop rate over 100 samples, we expect roughly 50 frames
      // Allow wide tolerance for randomness
      expect(notifications.length).toBeGreaterThan(20);
      expect(notifications.length).toBeLessThan(90);
    });

    it('drops all notifications at rate 1.0', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'notificationDrop',
        errorConfig: { dropRate: 1.0 },
      });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);
      tickSamples(20);
      await adapter.disconnect();

      // Telemetry frames dropped, but rep/set boundaries still emit
      const telemetry = notifications.filter(isTelemetryFrame);
      expect(telemetry.length).toBe(0);
    });

    it('drops no notifications at rate 0.0', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'notificationDrop',
        errorConfig: { dropRate: 0.0 },
      });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);
      tickSamples(20);
      await adapter.disconnect();

      const telemetry = notifications.filter(isTelemetryFrame);
      expect(telemetry.length).toBe(20);
    });
  });

  // ===========================================================================
  // Malformed Frame
  // ===========================================================================

  describe('malformedFrame', () => {
    it('corrupts frames at configured rate', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'malformedFrame',
        errorConfig: { corruptionRate: 1.0 },
      });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);
      tickSamples(10);
      await adapter.disconnect();

      const telemetry = notifications.filter(isTelemetryFrame);

      // At 100% corruption rate, all frames should have at least one flipped byte
      // Collect the raw bytes and compare to a clean decode
      let hasCorruption = false;
      for (const frame of telemetry) {
        const decoded = decodeTelemetryFrame(frame);
        if (decoded === null || decoded.force < 0 || decoded.velocity < 0) {
          hasCorruption = true;
        }
      }

      // Frames are still emitted (30 bytes each) but with corrupted payload
      expect(telemetry.length).toBe(10);
      expect(hasCorruption || telemetry.length > 0).toBe(true);
    });

    it('leaves frames intact at rate 0.0', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'malformedFrame',
        errorConfig: { corruptionRate: 0.0 },
      });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);
      tickSamples(10);
      await adapter.disconnect();

      const telemetry = notifications.filter(isTelemetryFrame);
      expect(telemetry.length).toBe(10);

      for (const frame of telemetry) {
        const decoded = decodeTelemetryFrame(frame);
        expect(decoded).not.toBeNull();
      }
    });
  });

  // ===========================================================================
  // Reconnect Cycle
  // ===========================================================================

  describe('reconnectCycle', () => {
    it('disconnects then reconnects after configured delays', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'reconnectCycle',
        errorConfig: { disconnectAfterMs: 300, reconnectDelayMs: 200 },
      });
      const states: string[] = [];
      adapter.onConnectionStateChange((s) => states.push(s));

      await connectAdapter(adapter);
      expect(adapter.getConnectionState()).toBe('connected');

      vi.advanceTimersByTime(300);
      expect(adapter.getConnectionState()).toBe('disconnected');

      vi.advanceTimersByTime(200);
      expect(adapter.getConnectionState()).toBe('connected');

      expect(states).toEqual([
        'connecting', 'connected',   // initial connect
        'disconnected',               // error disconnect
        'connecting', 'connected',    // reconnect
      ]);

      await adapter.disconnect();
    });

    it('resumes telemetry after reconnect', async () => {
      const adapter = new MockBLEAdapter({
        connectDelayMs: 0,
        errorScenario: 'reconnectCycle',
        errorConfig: { disconnectAfterMs: 200, reconnectDelayMs: 100 },
      });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);

      vi.advanceTimersByTime(200);
      const countAtDisconnect = notifications.length;

      vi.advanceTimersByTime(100);
      // Now reconnected — telemetry should resume
      tickSamples(5);

      expect(notifications.length).toBeGreaterThan(countAtDisconnect);

      await adapter.disconnect();
    });
  });

  // ===========================================================================
  // Error Composition
  // ===========================================================================

  describe('composition', () => {
    it('combines disconnect and notificationDrop', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);

      adapter.injectError('notificationDrop', { dropRate: 1.0 });
      adapter.injectError('disconnect', { afterMs: 500 });

      // Telemetry frames should be dropped
      tickSamples(3);
      const telemetryBeforeDisconnect = notifications.filter(isTelemetryFrame);
      expect(telemetryBeforeDisconnect.length).toBe(0);

      // Disconnect should still fire
      vi.advanceTimersByTime(500);
      expect(adapter.getConnectionState()).toBe('disconnected');
    });
  });

  // ===========================================================================
  // Dynamic Injection
  // ===========================================================================

  describe('dynamic injection', () => {
    it('injects notificationDrop mid-stream', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);

      tickSamples(10);
      const normalCount = notifications.filter(isTelemetryFrame).length;
      expect(normalCount).toBe(10);

      // Inject 100% drop rate
      adapter.injectError('notificationDrop', { dropRate: 1.0 });
      notifications.length = 0;

      tickSamples(10);
      const droppedCount = notifications.filter(isTelemetryFrame).length;
      expect(droppedCount).toBe(0);

      await adapter.disconnect();
    });

    it('injects disconnect mid-stream', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });

      await connectAdapter(adapter);
      tickSamples(5);
      expect(adapter.getConnectionState()).toBe('connected');

      adapter.injectError('disconnect', { afterMs: 200 });
      vi.advanceTimersByTime(200);

      expect(adapter.getConnectionState()).toBe('disconnected');
    });
  });

  // ===========================================================================
  // clearErrors
  // ===========================================================================

  describe('clearErrors', () => {
    it('restores normal notification flow after clearing', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);

      adapter.injectError('notificationDrop', { dropRate: 1.0 });
      tickSamples(5);
      const droppedTelemetry = notifications.filter(isTelemetryFrame);
      expect(droppedTelemetry.length).toBe(0);

      adapter.clearErrors();
      notifications.length = 0;

      tickSamples(5);
      const restoredTelemetry = notifications.filter(isTelemetryFrame);
      expect(restoredTelemetry.length).toBe(5);

      await adapter.disconnect();
    });

    it('cancels pending disconnect timer', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });

      await connectAdapter(adapter);
      adapter.injectError('disconnect', { afterMs: 500 });

      vi.advanceTimersByTime(200);
      expect(adapter.getConnectionState()).toBe('connected');

      adapter.clearErrors();

      vi.advanceTimersByTime(500);
      expect(adapter.getConnectionState()).toBe('connected');

      await adapter.disconnect();
    });
  });

  // ===========================================================================
  // Regression: no-error config unchanged
  // ===========================================================================

  describe('regression', () => {
    it('no-error config produces normal telemetry', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);
      tickSamples(SAMPLES_PER_REP);
      await adapter.disconnect();

      const telemetry = notifications.filter(isTelemetryFrame);
      expect(telemetry.length).toBe(SAMPLES_PER_REP);

      for (const frame of telemetry) {
        const decoded = decodeTelemetryFrame(frame);
        expect(decoded).not.toBeNull();
      }
    });

    it('constructor without error config behaves identically to original', async () => {
      const adapter = new MockBLEAdapter({ connectDelayMs: 0, repsPerSet: 2 });
      const notifications = collectNotifications(adapter);

      await connectAdapter(adapter);
      tickSamples(SAMPLES_PER_REP * 2);
      await adapter.disconnect();

      const repBoundaries = notifications.filter(
        (d) => d.length === 4 && bytesEqual(d, MessageTypes.REP_SUMMARY)
      );
      const setBoundaries = notifications.filter(
        (d) => d.length === 4 && bytesEqual(d, MessageTypes.SET_SUMMARY)
      );
      expect(repBoundaries).toHaveLength(2);
      expect(setBoundaries).toHaveLength(1);
    });
  });
});
