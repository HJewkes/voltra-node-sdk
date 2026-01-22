/**
 * Bluetooth Connection Model
 *
 * Represents generic BLE connection state and transitions.
 */

/**
 * BLE adapter connection states.
 */
export type BLEConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

/**
 * Valid state transitions for BLE connection.
 */
const VALID_BLE_TRANSITIONS: Record<BLEConnectionState, BLEConnectionState[]> = {
  disconnected: ['connecting'],
  connecting: ['connected', 'disconnected'],
  connected: ['disconnecting', 'disconnected'],
  disconnecting: ['disconnected'],
};

/**
 * Check if a BLE state transition is valid.
 */
export function isValidBLETransition(from: BLEConnectionState, to: BLEConnectionState): boolean {
  return VALID_BLE_TRANSITIONS[from].includes(to);
}

/**
 * Generic BLE connection state model with validation.
 */
export class BLEConnectionStateModel {
  private _state: BLEConnectionState = 'disconnected';

  get state(): BLEConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected';
  }

  get isConnecting(): boolean {
    return this._state === 'connecting';
  }

  get isDisconnected(): boolean {
    return this._state === 'disconnected';
  }

  /**
   * Transition to a new state.
   * @throws Error if transition is invalid
   */
  transitionTo(newState: BLEConnectionState): void {
    if (!isValidBLETransition(this._state, newState)) {
      throw new Error(`Invalid connection state transition: ${this._state} -> ${newState}`);
    }
    this._state = newState;
  }

  /**
   * Force set state (for reconnection scenarios).
   */
  forceState(state: BLEConnectionState): void {
    this._state = state;
  }

  /**
   * Reset to disconnected state.
   */
  reset(): void {
    this._state = 'disconnected';
  }
}
