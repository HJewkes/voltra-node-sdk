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
 * Bootstrap step 10 — 18-param mode-feature-state read.
 *
 * NOTE: This packet is NOT currently sent during `Init.SEQUENCE`. Sending it
 * during cold bootstrap caused the device firmware to drop the GATT link,
 * leaving `VoltraClient._connectionState='connected'` while the adapter's
 * write characteristic was already null (Bug 30, on-device 2026-05-07).
 * The 0.7.2 hotfix reverts the `Init.SEQUENCE` append. The constant + the
 * `decodeBulkParamResponse` decoder are kept in place for a future, safer
 * invocation mechanism (likely an explicit `client.queryDeviceSettings()`
 * call after connect stabilizes).
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
 * To start: set mode/weight -> SETUP -> GO
 * To stop: STOP
 */
export const Workout = {
  /**
   * Legacy "prepare" frame — a single-param write setting the workout state
   * to WeightTraining.
   *
   * **SDK-01.13:** no longer used by the recording path. It is functionally
   * `setMode(WeightTraining)` and, run before GO, silently clobbered the
   * caller's selected fitness mode (Damper/Iso reverted to WeightTraining).
   * `prepareRecording()` now issues SETUP + GO only. Retained as a documented
   * protocol primitive; do not reintroduce it into the recording sequence.
   */
  PREPARE: hexToBytes(protocol.commands.workout.prepare),
  /**
   * Multi-paramID READ for the saved cable offset and the live cable position.
   *
   * Reclassified in 0.5.2: previously documented as "Configure workout
   * mode," but it is a read, not a setter. The device responds with a
   * `cmd_0f_bulk_response` carrying the saved cable offset and the live
   * cable position.
   *
   * Kept under `Workout` for now to preserve the bootstrap-sequence
   * call-site contract; a later codegen refactor will relocate read-class
   * commands to a dedicated `Reads` / `ReadCmd` module.
   */
  SETUP: hexToBytes(protocol.commands.workout.setup),
  /** Start resistance/tracking */
  GO: hexToBytes(protocol.commands.workout.go),
  /** Stop resistance/tracking */
  STOP: hexToBytes(protocol.commands.workout.stop),
} as const;
