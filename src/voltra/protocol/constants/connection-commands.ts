/**
 * Connection Commands
 *
 * Authentication, initialization, and workout control commands.
 */

import { hexToBytes } from '../../../shared/utils';
import protocolData from '../data/protocol-data.generated';
import type { ProtocolData } from '../types';

const protocol = protocolData as ProtocolData;

// =============================================================================
// Authentication
// =============================================================================

/**
 * Device authentication identifiers.
 */
export const Auth = {
  /** Primary device identity */
  DEVICE_ID: hexToBytes(protocol.commands.auth.iphone),
  /** Alternative device identity */
  DEVICE_ID_IPAD: hexToBytes(protocol.commands.auth.ipad),
} as const;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Bootstrap step 10 — 18-param mode-feature-state read (cmd=0x0F).
 *
 * Triggers the device to push current settings (base weight, chains, eccentric,
 * mode, assist, band, isometric, position, cable offset, etc.) so the SDK can
 * populate `_settings` after a fresh connect or reconnect. Without this query
 * the device only volunteers state asynchronously in response to writes,
 * which is why post-reconnect `_settings` was stuck at defaults (Bug 17).
 *
 * Source: Android `VoltraOfficialReadOnlyBootstrap.kt` packet #10 (commit
 * `5be9a12`). The 18-param list and CRC values are documented in
 * `voltra-private/research/data-port-2026-05-07-android-deep.md` § 9; this
 * pre-CRC'd hex literal is reproduced verbatim from that source. Sequence
 * byte is fixed at 0x06 — this works as-is for both first-connect and
 * reconnect (the device does not enforce monotonic sequence numbers across
 * the bootstrap window).
 */
const MODE_FEATURE_STATE_18PARAM_QUERY_HEX =
  '553304c2aa10060020000f1200863e62536153b753b653e3520651873e883eb053c653893eb04f3154d253823e6a50bc54985a';

/**
 * Device initialization sequence.
 *
 * Appends the 18-param mode-feature-state query (bootstrap step 10) after
 * the existing connect-request + handshake-finish packets. Step 10 is a
 * read-only bulk query — it does NOT mutate device state, only requests a
 * settings cascade, which is decoded by the cmd=0x0F branch of
 * `decodeNotification` and merged into the client's `_settings`.
 */
export const Init = {
  SEQUENCE: [
    ...protocol.commands.init.map(hexToBytes),
    hexToBytes(MODE_FEATURE_STATE_18PARAM_QUERY_HEX),
  ],
} as const;

// =============================================================================
// Workout Commands
// =============================================================================

/**
 * Workout control commands.
 *
 * To start: set weight -> PREPARE -> SETUP -> GO
 * To stop: STOP
 */
export const Workout = {
  /** Prepare device for workout */
  PREPARE: hexToBytes(protocol.commands.workout.prepare),
  /** Configure workout mode */
  SETUP: hexToBytes(protocol.commands.workout.setup),
  /** Start resistance/tracking */
  GO: hexToBytes(protocol.commands.workout.go),
  /** Stop resistance/tracking */
  STOP: hexToBytes(protocol.commands.workout.stop),
} as const;
