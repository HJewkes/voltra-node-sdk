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
 * NOTE: This packet is NOT currently sent during `Init.SEQUENCE`. Sending it
 * during cold bootstrap caused VTR-097082 firmware to drop the GATT link,
 * leaving `VoltraClient._connectionState='connected'` while the adapter's
 * write characteristic was already null (Bug 30, on-device 2026-05-07).
 * The 0.7.2 hotfix reverts the `Init.SEQUENCE` append. The constant + the
 * `decodeCmd0x0FResponse` decoder are kept in place for a future, safer
 * invocation mechanism (likely an explicit `client.queryDeviceSettings()`
 * call after connect stabilizes — see audit § 7 Alt A).
 *
 * Original source: Android `VoltraOfficialReadOnlyBootstrap.kt` packet #10
 * (commit `5be9a12`). The 18-param list and CRC values are documented in
 * `voltra-private/research/data-port-2026-05-07-android-deep.md` § 9.
 */
const MODE_FEATURE_STATE_18PARAM_QUERY_HEX =
  '553304c2aa10060020000f1200863e62536153b753b653e3520651873e883eb053c653893eb04f3154d253823e6a50bc54985a';

// Re-export to keep the constant available for future callers without
// requiring the file to flag it as "unused" under TS noUnusedLocals.
export { MODE_FEATURE_STATE_18PARAM_QUERY_HEX };

/**
 * Device initialization sequence.
 *
 * Sends the 2-packet connect-request + handshake-finish pair documented in
 * `protocol.commands.init`. The 18-param mode-feature-state query
 * (`MODE_FEATURE_STATE_18PARAM_QUERY_HEX`, "bootstrap step 10") was appended
 * here in 0.7.0 to fix Bug 17 (post-reconnect settings cascade) but caused a
 * GATT-drop regression on real hardware (Bug 30); reverted in 0.7.2. Bug 17
 * remains open and will be re-addressed via a safer mechanism.
 */
export const Init = {
  SEQUENCE: protocol.commands.init.map(hexToBytes),
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
  /**
   * Multi-paramID READ for `MC_DEFAULT_OFFLEN_CM` (`0x506a`, LE bytes `6a 50`)
   * + `BP_RUNTIME_POSITION_CM` (`0x3e82`, LE bytes `82 3e`).
   *
   * Phase 0.5.2 reclassification: previously documented as "Configure
   * workout mode," but the byte layout (cmdID `0x0F` + reserved
   * `[0x02, 0x00]` + paramID pair, no value bytes between paramIDs and
   * CRC16) is the Type-C "config / multi-paramID read" envelope, not a
   * setter. The device responds with a `cmd_0f_bulk_response` carrying
   * the saved cable offset (`MC_DEFAULT_OFFLEN_CM`) and the live cable
   * position (`BP_RUNTIME_POSITION_CM`). See
   * `voltra-private/docs/protocol-reference.md` § "Workout Control" + the
   * paramID table; canonical bytes are
   * `55 13 04 03 aa 10 15 00 20 00 0f 02 00 6a 50 82 3e 8f 2f`.
   *
   * Kept under `Workout` for now to preserve the bootstrap-sequence
   * call-site contract; Phase 1 of the codegen refactor will relocate
   * read-class commands to a dedicated `Reads` / `ReadCmd` module.
   */
  SETUP: hexToBytes(protocol.commands.workout.setup),
  /** Start resistance/tracking */
  GO: hexToBytes(protocol.commands.workout.go),
  /** Stop resistance/tracking */
  STOP: hexToBytes(protocol.commands.workout.stop),
} as const;
