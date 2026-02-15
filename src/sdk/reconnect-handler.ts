/**
 * Reconnect Handler
 *
 * Manages automatic reconnection on unexpected disconnects.
 * Extracted from VoltraClient for modularity.
 */

import type { BLEAdapter } from '../bluetooth/adapters/types';
import { delay } from '../shared/utils';

/**
 * Options for the reconnect handler.
 */
export interface ReconnectOptions {
  /** Whether auto-reconnect is enabled */
  autoReconnect: boolean;
  /** Maximum number of reconnect attempts */
  maxReconnectAttempts: number;
  /** Delay between reconnect attempts in milliseconds */
  reconnectDelayMs: number;
}

/**
 * Callbacks the reconnect handler uses to interact with the client.
 */
export interface ReconnectCallbacks {
  /** Called when a reconnect attempt starts */
  onReconnecting: (attempt: number, maxAttempts: number) => void;
  /** Called to perform the actual reconnection */
  reconnect: () => Promise<void>;
  /** Called when all reconnect attempts have failed */
  onReconnectFailed: () => void;
}

/**
 * State tracked by the reconnect handler.
 */
export interface ReconnectState {
  isReconnecting: boolean;
  reconnectAttempt: number;
}

/**
 * Setup a disconnect handler on the adapter that triggers auto-reconnect.
 *
 * @param adapter BLE adapter to monitor
 * @param options Reconnect options
 * @param isConnected Function that returns current connection state
 * @param handleDisconnect Function to call on unexpected disconnect
 * @returns Unsubscribe function, or null if auto-reconnect is disabled
 */
export function setupDisconnectMonitor(
  adapter: BLEAdapter,
  options: ReconnectOptions,
  isConnected: () => boolean,
  handleDisconnect: () => void
): (() => void) | null {
  if (!options.autoReconnect) return null;

  const unsubscribe = adapter.onConnectionStateChange((state) => {
    if (state === 'disconnected' && isConnected()) {
      handleDisconnect();
    }
  });

  return unsubscribe;
}

/**
 * Attempt to reconnect with exponential backoff.
 *
 * @param options Reconnect options
 * @param callbacks Reconnect callbacks
 * @returns Final reconnect state
 */
export async function attemptReconnect(
  options: ReconnectOptions,
  callbacks: ReconnectCallbacks
): Promise<ReconnectState> {
  const state: ReconnectState = {
    isReconnecting: true,
    reconnectAttempt: 0,
  };

  while (state.reconnectAttempt < options.maxReconnectAttempts) {
    state.reconnectAttempt++;
    callbacks.onReconnecting(state.reconnectAttempt, options.maxReconnectAttempts);

    try {
      await delay(options.reconnectDelayMs);
      await callbacks.reconnect();
      state.isReconnecting = false;
      return state;
    } catch {
      // Continue to next attempt
    }
  }

  // All attempts failed
  state.isReconnecting = false;
  callbacks.onReconnectFailed();
  return state;
}
