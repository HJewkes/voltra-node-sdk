import { describe, it, expect } from 'vitest';
import {
  VoltraSDKError,
  ConnectionError,
  AuthenticationError,
  TimeoutError,
  NotConnectedError,
  InvalidSettingError,
  BluetoothUnavailableError,
  CommandError,
  TelemetryError,
  ErrorCode,
} from '../errors';

describe('errors', () => {
  // ===========================================================================
  // VoltraSDKError (base)
  // ===========================================================================

  describe('VoltraSDKError', () => {
    it('constructs with message and default code', () => {
      const err = new VoltraSDKError('test error');
      expect(err.message).toBe('test error');
      expect(err.code).toBe(ErrorCode.UNKNOWN);
      expect(err.name).toBe('VoltraSDKError');
    });

    it('constructs with custom code', () => {
      const err = new VoltraSDKError('test', ErrorCode.CONNECTION_FAILED);
      expect(err.code).toBe(ErrorCode.CONNECTION_FAILED);
    });

    it('stores cause', () => {
      const cause = new Error('original');
      const err = new VoltraSDKError('wrapped', ErrorCode.UNKNOWN, cause);
      expect(err.cause).toBe(cause);
    });

    it('is instanceof Error', () => {
      expect(new VoltraSDKError('test')).toBeInstanceOf(Error);
    });
  });

  // ===========================================================================
  // ConnectionError
  // ===========================================================================

  describe('ConnectionError', () => {
    it('has correct name and default code', () => {
      const err = new ConnectionError('connection lost');
      expect(err.name).toBe('ConnectionError');
      expect(err.code).toBe(ErrorCode.CONNECTION_FAILED);
      expect(err).toBeInstanceOf(VoltraSDKError);
      expect(err).toBeInstanceOf(Error);
    });

    it('accepts custom code', () => {
      const err = new ConnectionError('lost', ErrorCode.CONNECTION_LOST);
      expect(err.code).toBe(ErrorCode.CONNECTION_LOST);
    });
  });

  // ===========================================================================
  // AuthenticationError
  // ===========================================================================

  describe('AuthenticationError', () => {
    it('has correct name and default code', () => {
      const err = new AuthenticationError('auth failed');
      expect(err.name).toBe('AuthenticationError');
      expect(err.code).toBe(ErrorCode.AUTH_FAILED);
      expect(err).toBeInstanceOf(VoltraSDKError);
    });
  });

  // ===========================================================================
  // TimeoutError
  // ===========================================================================

  describe('TimeoutError', () => {
    it('stores timeout value', () => {
      const err = new TimeoutError('timed out', 5000);
      expect(err.name).toBe('TimeoutError');
      expect(err.code).toBe(ErrorCode.TIMEOUT);
      expect(err.timeoutMs).toBe(5000);
      expect(err).toBeInstanceOf(VoltraSDKError);
    });
  });

  // ===========================================================================
  // NotConnectedError
  // ===========================================================================

  describe('NotConnectedError', () => {
    it('has default message', () => {
      const err = new NotConnectedError();
      expect(err.message).toBe('Device is not connected');
      expect(err.code).toBe(ErrorCode.NOT_CONNECTED);
      expect(err).toBeInstanceOf(VoltraSDKError);
    });

    it('accepts custom message', () => {
      const err = new NotConnectedError('custom msg');
      expect(err.message).toBe('custom msg');
    });
  });

  // ===========================================================================
  // InvalidSettingError
  // ===========================================================================

  describe('InvalidSettingError', () => {
    it('stores setting, value, and validValues', () => {
      const err = new InvalidSettingError('weight', 999, [5, 10, 15]);
      expect(err.name).toBe('InvalidSettingError');
      expect(err.code).toBe(ErrorCode.INVALID_SETTING);
      expect(err.setting).toBe('weight');
      expect(err.value).toBe(999);
      expect(err.validValues).toEqual([5, 10, 15]);
      expect(err).toBeInstanceOf(VoltraSDKError);
    });

    it('generates default message with valid values', () => {
      const err = new InvalidSettingError('weight', 999, [5, 10]);
      expect(err.message).toContain('weight');
      expect(err.message).toContain('999');
      expect(err.message).toContain('5, 10');
    });

    it('generates message without valid values', () => {
      const err = new InvalidSettingError('mode', 'bad');
      expect(err.message).toContain('mode');
      expect(err.message).toContain('bad');
    });

    it('accepts custom message', () => {
      const err = new InvalidSettingError('weight', 999, undefined, 'custom');
      expect(err.message).toBe('custom');
    });
  });

  // ===========================================================================
  // BluetoothUnavailableError
  // ===========================================================================

  describe('BluetoothUnavailableError', () => {
    it('has default message without reason', () => {
      const err = new BluetoothUnavailableError();
      expect(err.code).toBe(ErrorCode.BLUETOOTH_UNAVAILABLE);
      expect(err.message).toContain('not available');
      expect(err.reason).toBeUndefined();
    });

    it('includes reason in message', () => {
      const err = new BluetoothUnavailableError('Powered off');
      expect(err.message).toContain('Powered off');
      expect(err.reason).toBe('Powered off');
    });
  });

  // ===========================================================================
  // CommandError
  // ===========================================================================

  describe('CommandError', () => {
    it('stores command name', () => {
      const err = new CommandError('write failed', 'setWeight');
      expect(err.name).toBe('CommandError');
      expect(err.code).toBe(ErrorCode.COMMAND_FAILED);
      expect(err.command).toBe('setWeight');
      expect(err).toBeInstanceOf(VoltraSDKError);
    });
  });

  // ===========================================================================
  // TelemetryError
  // ===========================================================================

  describe('TelemetryError', () => {
    it('has correct code', () => {
      const err = new TelemetryError('decode failed');
      expect(err.name).toBe('TelemetryError');
      expect(err.code).toBe(ErrorCode.TELEMETRY_DECODE_ERROR);
      expect(err).toBeInstanceOf(VoltraSDKError);
    });
  });

  // ===========================================================================
  // instanceof chain
  // ===========================================================================

  describe('instanceof chain', () => {
    it('all error types are instanceof VoltraSDKError and Error', () => {
      const errors = [
        new ConnectionError('test'),
        new AuthenticationError('test'),
        new TimeoutError('test', 1000),
        new NotConnectedError(),
        new InvalidSettingError('x', 1),
        new BluetoothUnavailableError(),
        new CommandError('test'),
        new TelemetryError('test'),
      ];

      for (const err of errors) {
        expect(err).toBeInstanceOf(VoltraSDKError);
        expect(err).toBeInstanceOf(Error);
      }
    });
  });
});
