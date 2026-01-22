/**
 * Voltra Connection Model
 *
 * Voltra-specific connection state that includes the authentication step.
 */

/**
 * Voltra-specific connection states (includes auth step).
 */
export type VoltraConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

/**
 * Valid state transitions for Voltra connection.
 */
const VALID_VOLTRA_TRANSITIONS: Record<VoltraConnectionState, VoltraConnectionState[]> = {
  disconnected: ['connecting'],
  connecting: ['authenticating', 'disconnected'],
  authenticating: ['connected', 'disconnected'],
  connected: ['disconnected'],
};

/**
 * Check if a Voltra state transition is valid.
 */
export function isValidVoltraTransition(
  from: VoltraConnectionState,
  to: VoltraConnectionState
): boolean {
  return VALID_VOLTRA_TRANSITIONS[from].includes(to);
}

/**
 * Voltra connection state model with validation.
 */
export class VoltraConnectionStateModel {
  private _state: VoltraConnectionState = 'disconnected';

  get state(): VoltraConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected';
  }

  get isConnecting(): boolean {
    return this._state === 'connecting' || this._state === 'authenticating';
  }

  get isDisconnected(): boolean {
    return this._state === 'disconnected';
  }

  /**
   * Transition to a new state.
   * @throws Error if transition is invalid
   */
  transitionTo(newState: VoltraConnectionState): void {
    if (!isValidVoltraTransition(this._state, newState)) {
      throw new Error(`Invalid connection state transition: ${this._state} -> ${newState}`);
    }
    this._state = newState;
  }

  /**
   * Force set state (for reconnection scenarios).
   */
  forceState(state: VoltraConnectionState): void {
    this._state = state;
  }

  /**
   * Reset to disconnected state.
   */
  reset(): void {
    this._state = 'disconnected';
  }
}
