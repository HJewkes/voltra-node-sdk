/**
 * Custom SDK Error Types
 *
 * Provides typed errors for better error handling and developer experience.
 * All SDK errors extend VoltraSDKError for easy catch-all handling.
 *
 * @example
 * ```typescript
 * try {
 *   await client.connect();
 * } catch (error) {
 *   if (error instanceof ConnectionError) {
 *     console.log('Connection failed:', error.code);
 *   } else if (error instanceof AuthenticationError) {
 *     console.log('Auth failed - device may need reset');
 *   } else if (error instanceof VoltraSDKError) {
 *     console.log('SDK error:', error.message);
 *   }
 * }
 * ```
 */

/**
 * Error codes for SDK errors.
 * Use these for programmatic error handling.
 */
export const ErrorCode = {
  // Connection errors
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  CONNECTION_LOST: 'CONNECTION_LOST',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  NOT_CONNECTED: 'NOT_CONNECTED',
  ALREADY_CONNECTED: 'ALREADY_CONNECTED',

  // Authentication errors
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_TIMEOUT: 'AUTH_TIMEOUT',
  AUTH_INVALID_RESPONSE: 'AUTH_INVALID_RESPONSE',

  // Bluetooth errors
  BLUETOOTH_UNAVAILABLE: 'BLUETOOTH_UNAVAILABLE',
  BLUETOOTH_PERMISSION_DENIED: 'BLUETOOTH_PERMISSION_DENIED',
  BLUETOOTH_ADAPTER_ERROR: 'BLUETOOTH_ADAPTER_ERROR',

  // Device errors
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  DEVICE_DISCONNECTED: 'DEVICE_DISCONNECTED',

  // Command errors
  COMMAND_FAILED: 'COMMAND_FAILED',
  COMMAND_TIMEOUT: 'COMMAND_TIMEOUT',
  INVALID_SETTING: 'INVALID_SETTING',

  // Telemetry errors
  TELEMETRY_DECODE_ERROR: 'TELEMETRY_DECODE_ERROR',

  // General
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Base error class for all SDK errors.
 * Provides a consistent error interface with error codes.
 */
export class VoltraSDKError extends Error {
  public readonly code: ErrorCode;
  public readonly cause?: Error;

  constructor(message: string, code: ErrorCode = ErrorCode.UNKNOWN, cause?: Error) {
    super(message);
    this.name = 'VoltraSDKError';
    this.code = code;
    this.cause = cause;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when a BLE connection fails or is lost.
 */
export class ConnectionError extends VoltraSDKError {
  constructor(message: string, code: ErrorCode = ErrorCode.CONNECTION_FAILED, cause?: Error) {
    super(message, code, cause);
    this.name = 'ConnectionError';
  }
}

/**
 * Thrown when Voltra device authentication fails.
 * This typically happens during the initial connection handshake.
 */
export class AuthenticationError extends VoltraSDKError {
  constructor(message: string, code: ErrorCode = ErrorCode.AUTH_FAILED, cause?: Error) {
    super(message, code, cause);
    this.name = 'AuthenticationError';
  }
}

/**
 * Thrown when an operation times out.
 */
export class TimeoutError extends VoltraSDKError {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, cause?: Error) {
    super(message, ErrorCode.TIMEOUT, cause);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when an operation requires a connection but the device is not connected.
 */
export class NotConnectedError extends VoltraSDKError {
  constructor(message: string = 'Device is not connected') {
    super(message, ErrorCode.NOT_CONNECTED);
    this.name = 'NotConnectedError';
  }
}

/**
 * Thrown when an invalid setting value is provided.
 * For example, setting weight to a value not supported by the device.
 */
export class InvalidSettingError extends VoltraSDKError {
  public readonly setting: string;
  public readonly value: unknown;
  public readonly validValues?: readonly unknown[];

  constructor(setting: string, value: unknown, validValues?: readonly unknown[], message?: string) {
    const msg =
      message ??
      `Invalid value for ${setting}: ${value}${validValues ? `. Valid values: ${validValues.join(', ')}` : ''}`;
    super(msg, ErrorCode.INVALID_SETTING);
    this.name = 'InvalidSettingError';
    this.setting = setting;
    this.value = value;
    this.validValues = validValues;
  }
}

/**
 * Thrown when Bluetooth is not available on the current platform.
 */
export class BluetoothUnavailableError extends VoltraSDKError {
  public readonly reason?: string;

  constructor(reason?: string) {
    const message = reason
      ? `Bluetooth is not available: ${reason}`
      : 'Bluetooth is not available on this device';
    super(message, ErrorCode.BLUETOOTH_UNAVAILABLE);
    this.name = 'BluetoothUnavailableError';
    this.reason = reason;
  }
}

/**
 * Thrown when a command fails to execute on the device.
 */
export class CommandError extends VoltraSDKError {
  public readonly command?: string;

  constructor(message: string, command?: string, cause?: Error) {
    super(message, ErrorCode.COMMAND_FAILED, cause);
    this.name = 'CommandError';
    this.command = command;
  }
}

/**
 * Thrown when telemetry data cannot be decoded.
 */
export class TelemetryError extends VoltraSDKError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.TELEMETRY_DECODE_ERROR, cause);
    this.name = 'TelemetryError';
  }
}
