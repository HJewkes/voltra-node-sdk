import { describe, it, expect } from 'vitest';
import {
  isValidVoltraTransition,
  VoltraConnectionStateModel,
  type VoltraConnectionState,
} from '../connection';

describe('connection', () => {
  // ===========================================================================
  // isValidVoltraTransition
  // ===========================================================================

  describe('isValidVoltraTransition', () => {
    const validTransitions: [VoltraConnectionState, VoltraConnectionState][] = [
      ['disconnected', 'connecting'],
      ['connecting', 'authenticating'],
      ['connecting', 'disconnected'],
      ['authenticating', 'connected'],
      ['authenticating', 'disconnected'],
      ['connected', 'disconnected'],
    ];

    for (const [from, to] of validTransitions) {
      it(`allows ${from} -> ${to}`, () => {
        expect(isValidVoltraTransition(from, to)).toBe(true);
      });
    }

    const invalidTransitions: [VoltraConnectionState, VoltraConnectionState][] = [
      ['disconnected', 'connected'],
      ['disconnected', 'authenticating'],
      ['disconnected', 'disconnected'],
      ['connecting', 'connecting'],
      ['connecting', 'connected'],
      ['authenticating', 'authenticating'],
      ['authenticating', 'connecting'],
      ['connected', 'connecting'],
      ['connected', 'authenticating'],
      ['connected', 'connected'],
    ];

    for (const [from, to] of invalidTransitions) {
      it(`rejects ${from} -> ${to}`, () => {
        expect(isValidVoltraTransition(from, to)).toBe(false);
      });
    }
  });

  // ===========================================================================
  // VoltraConnectionStateModel
  // ===========================================================================

  describe('VoltraConnectionStateModel', () => {
    it('starts in disconnected state', () => {
      const model = new VoltraConnectionStateModel();
      expect(model.state).toBe('disconnected');
      expect(model.isDisconnected).toBe(true);
      expect(model.isConnected).toBe(false);
      expect(model.isConnecting).toBe(false);
    });

    it('transitions through the full connection lifecycle', () => {
      const model = new VoltraConnectionStateModel();

      model.transitionTo('connecting');
      expect(model.state).toBe('connecting');
      expect(model.isConnecting).toBe(true);

      model.transitionTo('authenticating');
      expect(model.state).toBe('authenticating');
      expect(model.isConnecting).toBe(true);

      model.transitionTo('connected');
      expect(model.state).toBe('connected');
      expect(model.isConnected).toBe(true);
      expect(model.isConnecting).toBe(false);

      model.transitionTo('disconnected');
      expect(model.state).toBe('disconnected');
      expect(model.isDisconnected).toBe(true);
    });

    it('throws on invalid transition', () => {
      const model = new VoltraConnectionStateModel();
      expect(() => model.transitionTo('connected')).toThrow(
        'Invalid connection state transition: disconnected -> connected'
      );
    });

    it('throws on same-state transition', () => {
      const model = new VoltraConnectionStateModel();
      expect(() => model.transitionTo('disconnected')).toThrow();
    });

    it('reset() returns to disconnected', () => {
      const model = new VoltraConnectionStateModel();
      model.transitionTo('connecting');
      model.transitionTo('authenticating');
      model.transitionTo('connected');

      model.reset();
      expect(model.state).toBe('disconnected');
      expect(model.isDisconnected).toBe(true);
    });

    it('forceState() bypasses validation', () => {
      const model = new VoltraConnectionStateModel();
      // Direct jump to connected (normally invalid from disconnected)
      model.forceState('connected');
      expect(model.state).toBe('connected');
      expect(model.isConnected).toBe(true);
    });
  });
});
