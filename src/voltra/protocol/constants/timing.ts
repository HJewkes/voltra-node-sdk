/**
 * Timing Configuration
 *
 * Delays and timeouts for device communication.
 */

export const Timing = {
  /** Delay between init commands (ms) */
  INIT_COMMAND_DELAY_MS: 20,
  /** Delay between dual commands like chains/eccentric (ms) */
  DUAL_COMMAND_DELAY_MS: 500,
  /** Timeout for authentication response (ms) */
  AUTH_TIMEOUT_MS: 3000,
  /** Minimum responses expected during auth */
  MIN_AUTH_RESPONSES: 2,
  /** Minimum responses expected after commands */
  MIN_COMMAND_RESPONSES: 4,
} as const;
