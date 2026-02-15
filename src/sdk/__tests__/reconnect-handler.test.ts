import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setupDisconnectMonitor,
  attemptReconnect,
  type ReconnectOptions,
  type ReconnectCallbacks,
} from '../reconnect-handler';
import type { BLEAdapter, ConnectionStateCallback } from '../../bluetooth/adapters/types';

// Mock delay so tests don't actually wait
vi.mock('../../shared/utils', () => ({
  delay: vi.fn(() => Promise.resolve()),
}));

function makeAdapter(): BLEAdapter & {
  onConnectionStateChange: ReturnType<typeof vi.fn>;
} {
  return {
    scan: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    write: vi.fn(),
    onNotification: vi.fn(() => () => {}),
    onConnectionStateChange: vi.fn(() => () => {}),
    getConnectionState: vi.fn(() => 'disconnected' as const),
    isConnected: vi.fn(() => false),
  };
}

describe('reconnect-handler', () => {
  // ===========================================================================
  // setupDisconnectMonitor
  // ===========================================================================

  describe('setupDisconnectMonitor', () => {
    it('returns null when autoReconnect is false', () => {
      const adapter = makeAdapter();
      const options: ReconnectOptions = {
        autoReconnect: false,
        maxReconnectAttempts: 3,
        reconnectDelayMs: 1000,
      };

      const result = setupDisconnectMonitor(adapter, options, () => true, () => {});

      expect(result).toBeNull();
      expect(adapter.onConnectionStateChange).not.toHaveBeenCalled();
    });

    it('registers a connection state listener when autoReconnect is true', () => {
      const adapter = makeAdapter();
      const options: ReconnectOptions = {
        autoReconnect: true,
        maxReconnectAttempts: 3,
        reconnectDelayMs: 1000,
      };

      const unsub = setupDisconnectMonitor(adapter, options, () => true, () => {});

      expect(unsub).toBeTypeOf('function');
      expect(adapter.onConnectionStateChange).toHaveBeenCalledOnce();
    });

    it('calls handleDisconnect when state goes to disconnected while connected', () => {
      const adapter = makeAdapter();
      let capturedCallback: ConnectionStateCallback | null = null;
      adapter.onConnectionStateChange.mockImplementation((cb: ConnectionStateCallback) => {
        capturedCallback = cb;
        return () => {};
      });

      const handleDisconnect = vi.fn();
      const options: ReconnectOptions = {
        autoReconnect: true,
        maxReconnectAttempts: 3,
        reconnectDelayMs: 1000,
      };

      setupDisconnectMonitor(adapter, options, () => true, handleDisconnect);

      // Simulate unexpected disconnect
      capturedCallback!('disconnected');
      expect(handleDisconnect).toHaveBeenCalledOnce();
    });

    it('does NOT call handleDisconnect when already disconnected', () => {
      const adapter = makeAdapter();
      let capturedCallback: ConnectionStateCallback | null = null;
      adapter.onConnectionStateChange.mockImplementation((cb: ConnectionStateCallback) => {
        capturedCallback = cb;
        return () => {};
      });

      const handleDisconnect = vi.fn();
      const options: ReconnectOptions = {
        autoReconnect: true,
        maxReconnectAttempts: 3,
        reconnectDelayMs: 1000,
      };

      // isConnected returns false
      setupDisconnectMonitor(adapter, options, () => false, handleDisconnect);

      capturedCallback!('disconnected');
      expect(handleDisconnect).not.toHaveBeenCalled();
    });

    it('does NOT call handleDisconnect for non-disconnect states', () => {
      const adapter = makeAdapter();
      let capturedCallback: ConnectionStateCallback | null = null;
      adapter.onConnectionStateChange.mockImplementation((cb: ConnectionStateCallback) => {
        capturedCallback = cb;
        return () => {};
      });

      const handleDisconnect = vi.fn();
      const options: ReconnectOptions = {
        autoReconnect: true,
        maxReconnectAttempts: 3,
        reconnectDelayMs: 1000,
      };

      setupDisconnectMonitor(adapter, options, () => true, handleDisconnect);

      capturedCallback!('connecting');
      capturedCallback!('connected');
      expect(handleDisconnect).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // attemptReconnect
  // ===========================================================================

  describe('attemptReconnect', () => {
    const defaultOptions: ReconnectOptions = {
      autoReconnect: true,
      maxReconnectAttempts: 3,
      reconnectDelayMs: 100,
    };

    it('succeeds on first attempt', async () => {
      const callbacks: ReconnectCallbacks = {
        onReconnecting: vi.fn(),
        reconnect: vi.fn().mockResolvedValue(undefined),
        onReconnectFailed: vi.fn(),
      };

      const state = await attemptReconnect(defaultOptions, callbacks);

      expect(state.isReconnecting).toBe(false);
      expect(state.reconnectAttempt).toBe(1);
      expect(callbacks.onReconnecting).toHaveBeenCalledOnce();
      expect(callbacks.onReconnecting).toHaveBeenCalledWith(1, 3);
      expect(callbacks.reconnect).toHaveBeenCalledOnce();
      expect(callbacks.onReconnectFailed).not.toHaveBeenCalled();
    });

    it('succeeds on second attempt after first failure', async () => {
      const callbacks: ReconnectCallbacks = {
        onReconnecting: vi.fn(),
        reconnect: vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce(undefined),
        onReconnectFailed: vi.fn(),
      };

      const state = await attemptReconnect(defaultOptions, callbacks);

      expect(state.isReconnecting).toBe(false);
      expect(state.reconnectAttempt).toBe(2);
      expect(callbacks.onReconnecting).toHaveBeenCalledTimes(2);
      expect(callbacks.onReconnecting).toHaveBeenNthCalledWith(1, 1, 3);
      expect(callbacks.onReconnecting).toHaveBeenNthCalledWith(2, 2, 3);
      expect(callbacks.onReconnectFailed).not.toHaveBeenCalled();
    });

    it('calls onReconnectFailed when all attempts fail', async () => {
      const callbacks: ReconnectCallbacks = {
        onReconnecting: vi.fn(),
        reconnect: vi.fn().mockRejectedValue(new Error('fail')),
        onReconnectFailed: vi.fn(),
      };

      const state = await attemptReconnect(defaultOptions, callbacks);

      expect(state.isReconnecting).toBe(false);
      expect(state.reconnectAttempt).toBe(3);
      expect(callbacks.onReconnecting).toHaveBeenCalledTimes(3);
      expect(callbacks.reconnect).toHaveBeenCalledTimes(3);
      expect(callbacks.onReconnectFailed).toHaveBeenCalledOnce();
    });

    it('calls onReconnecting with correct attempt/maxAttempts on each try', async () => {
      const callbacks: ReconnectCallbacks = {
        onReconnecting: vi.fn(),
        reconnect: vi.fn().mockRejectedValue(new Error('fail')),
        onReconnectFailed: vi.fn(),
      };

      await attemptReconnect(defaultOptions, callbacks);

      expect(callbacks.onReconnecting).toHaveBeenNthCalledWith(1, 1, 3);
      expect(callbacks.onReconnecting).toHaveBeenNthCalledWith(2, 2, 3);
      expect(callbacks.onReconnecting).toHaveBeenNthCalledWith(3, 3, 3);
    });

    it('respects maxReconnectAttempts = 1', async () => {
      const callbacks: ReconnectCallbacks = {
        onReconnecting: vi.fn(),
        reconnect: vi.fn().mockRejectedValue(new Error('fail')),
        onReconnectFailed: vi.fn(),
      };

      const state = await attemptReconnect(
        { ...defaultOptions, maxReconnectAttempts: 1 },
        callbacks
      );

      expect(state.reconnectAttempt).toBe(1);
      expect(callbacks.reconnect).toHaveBeenCalledTimes(1);
      expect(callbacks.onReconnectFailed).toHaveBeenCalledOnce();
    });
  });
});
