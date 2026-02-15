/**
 * SDK Logger
 *
 * Scoped, opt-in debug logging for SDK internals.
 * Silent by default — consumers enable via `setDebugEnabled(true)`.
 *
 * Usage:
 *   const log = createLogger('NativeBLE');
 *   log.debug('Starting scan...');      // [NativeBLE] Starting scan...
 *   log.warn('MTU request failed');      // [NativeBLE] MTU request failed
 *   log.error('Connect error:', error);  // [NativeBLE] Connect error: ...
 */

let debugEnabled = false;

/**
 * Enable or disable SDK debug logging.
 * When disabled (default), only warnings and errors are emitted.
 */
export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
}

/**
 * Check if debug logging is enabled.
 */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Scoped logger for a specific SDK module.
 */
export interface Logger {
  /** Debug-level output (only when debug enabled) */
  debug: (...args: unknown[]) => void;
  /** Warning-level output (always emitted) */
  warn: (...args: unknown[]) => void;
  /** Error-level output (always emitted) */
  error: (...args: unknown[]) => void;
}

/**
 * Create a scoped logger for a module.
 *
 * @param tag Module name shown in brackets, e.g. 'NativeBLE'
 */
export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`;

  return {
    debug: (...args: unknown[]) => {
      if (debugEnabled) {
        // eslint-disable-next-line no-console
        console.log(prefix, ...args);
      }
    },
    warn: (...args: unknown[]) => {
      console.warn(prefix, ...args);
    },
    error: (...args: unknown[]) => {
      console.error(prefix, ...args);
    },
  };
}
