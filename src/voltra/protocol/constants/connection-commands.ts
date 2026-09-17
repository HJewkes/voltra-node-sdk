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
 * The wide mode-feature-state read that was once appended to `Init.SEQUENCE`.
 *
 * NOT sent, and not to be restored. Sending it during cold bootstrap made the
 * device firmware drop the GATT link, leaving the client believing it was
 * connected while the adapter's write characteristic was already null (Bug 30,
 * on-device 2026-05-07). Reverted in 0.7.2.
 *
 * The safer mechanism it was waiting for is `client.refreshDeviceState()`
 * (VW-403), which reads three registers instead of eighteen and runs after the
 * connection is established rather than during bootstrap. The constant stays
 * only so the hazard keeps a name.
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
 * `protocol.commands.init`, and nothing else. A wide state query was appended
 * here in 0.7.0 and caused a GATT-drop regression on real hardware (Bug 30);
 * reverted in 0.7.2 and not to be restored.
 *
 * The device answers the handshake finish with its own acceptance report; the
 * client waits for that before calling the connection established, then reads
 * core state back over an established link (VW-403).
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
