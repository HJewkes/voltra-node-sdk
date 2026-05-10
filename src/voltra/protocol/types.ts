/**
 * TypeScript types for the consolidated protocol.json structure.
 *
 * These types define the shape of the public protocol data used for
 * command lookup and notification parsing.
 */

import type { TrainingMode } from './constants';

// =============================================================================
// Root Protocol Structure
// =============================================================================

/**
 * Root protocol data structure.
 */
export interface ProtocolData {
  /** Protocol version (semver) */
  version: string;
  /** BLE configuration */
  ble: BleConfig;
  /** Command definitions */
  commands: CommandConfig;
  /** Telemetry parsing configuration */
  telemetry: TelemetryConfig;
}

// =============================================================================
// BLE Configuration
// =============================================================================

/**
 * BLE service and characteristic UUIDs.
 */
export interface BleConfig {
  /** Main service UUID for Voltra devices */
  serviceUuid: string;
  /** Characteristic UUID for receiving notifications */
  notifyCharUuid: string;
  /** Characteristic UUID for writing commands */
  writeCharUuid: string;
  /** Device name prefix for scanning (e.g., "VTR-") */
  deviceNamePrefix: string;
}

// =============================================================================
// Command Configuration
// =============================================================================

/**
 * All command definitions.
 */
export interface CommandConfig {
  /** Authentication commands */
  auth: AuthCommands;
  /** Initialization sequence */
  init: string[];
  /** Workout control commands */
  workout: WorkoutCommands;
  /** Training mode commands (mode name -> hex string) */
  modes: ModeCommands;
  /** Weight commands (lbs -> hex string) */
  weights: Record<string, string>;
  /** Chains commands (lbs -> hex string) */
  chains: Record<string, string>;
  /** Eccentric commands (value -> hex string) */
  eccentric: Record<string, string>;
  /** Inverse chains commands (lbs -> hex string) */
  inverseChains: Record<string, string>;
  /** Damper level commands (0-9 -> hex string; UI displays N+1) */
  damperLevel: Record<string, string>;
  /** Assist mode commands (off/on -> hex string) */
  assistMode: Record<'off' | 'on', string>;
  /** Resistance band max force commands (lbs -> hex string) */
  bandMaxForce: Record<string, string>;
  /** Isokinetic target speed commands (mm/s -> hex string; UI shows ÷1000 m/s) */
  isokineticTargetSpeed: Record<string, string>;
  /** Isokinetic eccentric mode commands (isokinetic/constant -> hex string) */
  isokineticEccMode: Record<'isokinetic' | 'constant', string>;
  /** Isokinetic eccentric speed limit commands (mm/s -> hex string; 0 = auto) */
  isokineticEccSpeedLimit: Record<string, string>;
  /** Isokinetic eccentric constant-mode weight commands (lbs -> hex string) */
  isokineticEccConstWeight: Record<string, string>;
  /** Isokinetic eccentric overload-mode weight commands (lbs -> hex string) */
  isokineticEccOverloadWeight: Record<string, string>;
  /** Telemetry rate commands (Hz -> hex string) */
  telemetryRate: Record<string, string>;
  /** Telemetry subscribe commands (none/all -> hex string) */
  telemetrySubscribe: Record<'none' | 'all', string>;
  /** Cable trigger commands (open/close -> hex string) */
  cableTrigger: Record<'open' | 'close', string>;
  /** Resistance experience commands (intense/standard -> hex string) */
  resistanceExperience: Record<'intense' | 'standard', string>;
}

/**
 * Training mode commands.
 */
export interface ModeCommands {
  /** Idle mode (0x0000) */
  idle: string;
  /** Weight training mode (0x0001) */
  weightTraining: string;
  /** Resistance band mode (0x0002) */
  resistanceBand: string;
  /** Rowing mode (0x0003) */
  rowing: string;
  /** Damper mode (0x0004) */
  damper: string;
  /** Custom curves mode (0x0006) */
  customCurves: string;
  /** Isokinetic mode (0x0007) */
  isokinetic: string;
  /** Isometric mode (0x0008) */
  isometric: string;
}

/**
 * Authentication device IDs.
 */
export interface AuthCommands {
  /** iPhone device ID (41-byte hex) */
  iphone: string;
  /** iPad device ID (41-byte hex) */
  ipad: string;
}

/**
 * Workout control commands.
 */
export interface WorkoutCommands {
  /** Prepare for workout */
  prepare: string;
  /** Setup workout mode */
  setup: string;
  /** Start resistance (go) */
  go: string;
  /** Stop resistance */
  stop: string;
}

// =============================================================================
// Telemetry Configuration
// =============================================================================

/**
 * Telemetry parsing configuration.
 */
export interface TelemetryConfig {
  /** Message type identifiers (first 4 bytes) */
  messageTypes: MessageTypeConfig;
  /** Byte offsets for parsing telemetry stream */
  offsets: OffsetConfig;
  /** Movement phase values */
  phases: PhaseConfig;
  /** Notification type parsing configurations */
  notifications: NotificationsConfig;
  /** Param IDs that use 2-byte (uint16) values in notifications (others use 1-byte uint8) */
  uint16ParamIds?: string[];
  /** Known parameter IDs */
  paramIds: ParamIdsConfig;
  /** Training mode values */
  trainingModes: TrainingModesConfig;
  /** Vendor frame sub-type definitions */
  vendorMessages: VendorMessagesConfig;
}

/**
 * Message type header bytes (4-byte hex strings).
 *
 * Phase A on-device validation (2026-05-05, 1369 frames) confirmed that
 * the previously-documented `repSummary`, `setSummary`, and `statusUpdate`
 * 4-byte signatures were aliases for vendor sub-type frames (perRep,
 * inProgress) and the 2-byte statusBattery notification respectively.
 * They were collapsed into a single classification path; only the
 * telemetry stream remains as a distinct 4-byte signature.
 */
export interface MessageTypeConfig {
  /** Real-time telemetry stream (~11 Hz) */
  stream: string;
}

/**
 * Vendor frame sub-type definitions.
 *
 * Vendor frames carry a 0xaa cmd marker at frame offset `cmdByteOffset`
 * followed by sub-type identifier bytes (e.g., [0x82, 0x3b] = perRep).
 */
export interface VendorMessagesConfig {
  /** Byte offset of the vendor cmd marker (0xaa) within the frame */
  cmdByteOffset: number;
  /** Vendor cmd marker value (0xaa) */
  cmdValue: number;
  /** Documented sub-type frames */
  subTypes: VendorSubTypesConfig;
}

export interface VendorSubTypesConfig {
  /** Per-rep boundary frame (74 B). Fires at pull start and return start. */
  perRep: VendorSubTypeConfig;
  /** End-of-workout summary frame (140 B). Fires once after STOP. */
  summary: VendorSubTypeConfig;
  /** Recurring in-progress telemetry (79 B). Was previously aliased as setSummary. */
  inProgress: VendorSubTypeConfig;
  /**
   * `aa 85 5f` set-summary frame (110 B). Device emits one per set in
   * WT/RB/Damper after all reps complete. Renamed from `preSummary` in 0.9.0;
   * see SetSummaryEvent for the misnomer history.
   */
  setSummary: VendorSubTypeConfig;
  /** Rowing-mode telemetry. Field offsets unvalidated. */
  rowing: VendorSubTypeConfig;
  /** Per-set isometric summary. Field layout unknown. */
  isometricSummary: VendorSubTypeConfig;
  /** Indexed batches of isometric force samples. */
  isometricWaveform: VendorSubTypeConfig;
}

/**
 * A single vendor sub-type definition.
 */
export interface VendorSubTypeConfig {
  /** Identifier bytes following the cmd marker (1–3 bytes) */
  identifierBytes: number[];
  /** Total frame length in bytes, or null for variable-length frames */
  frameLength: number | null;
  /** Whether field offsets are validated against device captures */
  fieldsValidated: boolean;
  /** Optional parsed field positions */
  fields?: Record<
    string,
    { payloadOffset: number; byteLength: number; byteOrder?: 'big' | 'little' }
  >;
  /** Optional motion-phase enum (perRep only) */
  motionPhases?: { pull: number; return: number };
  /**
   * Optional payload offset of the per-mode schema-version byte.
   * Only present on `summary` and `setSummary` whose 4-byte sub-type is
   * `cmd 0xAA + 2-byte fixed identifier + this byte`.
   */
  schemaVersionByteOffset?: number;
  /** Optional sample unit metadata (isometricWaveform only) */
  sampleUnit?: string;
  /** Optional notes from external research */
  externalNotes?: string[];
}

/**
 * Byte offsets for parsing telemetry stream messages.
 */
export interface OffsetConfig {
  /** Sequence number (2 bytes, little-endian) */
  sequence: number;
  /** Movement phase (1 byte) */
  phase: number;
  /** Position (2 bytes, little-endian unsigned) */
  position: number;
  /** Force (2 bytes, little-endian signed) */
  force: number;
  /** Velocity (2 bytes, little-endian unsigned) */
  velocity: number;
}

/**
 * Movement phase byte values.
 */
export interface PhaseConfig {
  /** Idle state */
  idle: number;
  /** Concentric phase (pulling/muscle shortening) */
  concentric: number;
  /** Hold phase (top of rep/transition) */
  hold: number;
  /** Eccentric phase (lowering/muscle lengthening) */
  eccentric: number;
}

// =============================================================================
// Notification Configuration
// =============================================================================

/**
 * Configuration for parsing a specific notification type.
 */
export interface NotificationTypeConfig {
  /** Header bytes to identify this notification type (hex string) */
  header: string;
  /** Expected message length in bytes */
  length?: number;
  /** Offset of parameter ID field */
  paramIdOffset?: number;
  /** Offset of value field */
  valueOffset?: number;
  /** Offset of integrity check value */
  crcOffset?: number;
  /** Offset of parameter count field (for multi-param messages) */
  paramCountOffset?: number;
  /** Offset of first parameter (for multi-param messages) */
  firstParamOffset?: number;
  /** Size of each param+value pair in bytes */
  paramSize?: number;
  /** Offset of battery level field */
  batteryOffset?: number;
}

/**
 * All notification type configurations.
 */
export interface NotificationsConfig {
  /** Mode change confirmation (0x12) */
  modeConfirmation: NotificationTypeConfig;
  /** Multi-parameter message (0x16) */
  multiParam: NotificationTypeConfig;
  /** Settings update with all parameters (0x2e) */
  settingsUpdate: NotificationTypeConfig;
  /** Device initialization info (0x23) */
  deviceInit: NotificationTypeConfig;
  /** Status/battery update (0x34) */
  statusBattery: NotificationTypeConfig;
}

/**
 * Known parameter IDs (hex strings, little-endian).
 */
export interface ParamIdsConfig {
  /** Base weight parameter (0x863e) */
  baseWeight: string;
  /** Chains weight parameter (0x873e) */
  chains: string;
  /** Eccentric setting parameter (0x883e) */
  eccentric: string;
  /** Training mode parameter (0xb04f) */
  trainingMode: string;
  /** Inverse chains parameter (0xb053) */
  inverseChains: string;
  /**
   * `BP_SET_FITNESS_MODE` (0x893e) — workout-state register controlling
   * the device's primary mode/state machine (strength READY/ARMED/ACTIVE,
   * direct-load STRENGTH_READY, rowing GO/ACTIVE, etc).
   */
  bpSetFitnessMode: string;
}

/**
 * Training mode values.
 */
export interface TrainingModesConfig {
  /** Idle state */
  idle: number;
  /** Weight training mode */
  weightTraining: number;
  /** Resistance band mode */
  resistanceBand: number;
  /** Rowing mode */
  rowing: number;
  /** Damper mode */
  damper: number;
  /** Custom curves mode */
  customCurves: number;
  /** Isokinetic mode */
  isokinetic: number;
  /** Isometric mode */
  isometric: number;
}

// =============================================================================
// Parsed Data Types
// =============================================================================

/**
 * Parsed device settings from notifications.
 */
export interface DeviceSettings {
  /** Base weight in lbs */
  baseWeight?: number;
  /** Chains weight in lbs */
  chains?: number;
  /** Eccentric setting */
  eccentric?: number;
  /** Current training mode */
  trainingMode?: TrainingMode;
  /** Inverse chains setting */
  inverseChains?: number;
  /**
   * Damper level (protocol value 0-9; UI displays N+1).
   * Reflected when paramId 0x0351 is present in a settings_update notification.
   */
  damperLevel?: number;
}

// <Decoder-cmd07-cmd10> ==========================================================
// State-dump (cmd=0x07 / 52-byte aa80-25 envelope) parsed payload.
//
// Field offsets validated on-device in the 2026-05-07 session E captures
// (cmd-0x07-variable-layout-fix-2026-05-08 investigation in voltra-private/research).
// The earlier "variable-layout / discriminator byte" hypothesis was disproved:
// the 37-byte payload following `aa 80 25` has a fixed layout across every
// observed (trainingMode × assistMode × transition) combination. Only fields
// stable across the captured frames are exposed.
// CRC trailer occupies frame[encodedLength-2 .. encodedLength-1], i.e. the
// last 2 bytes of the 52-byte frame, not inside the decoded payload.
// ==========================================================
/**
 * Parsed state-dump frame (52-byte `0xAA 0x80 0x25` envelope).
 *
 * Field semantics validated against on-device captures in session E
 * (2026-05-07). Earlier decoder versions mislabelled `trainingMode` as
 * `chainsActive` and read `chainTargetForceTenths` from the wrong offset
 * (where weight-in-tenths actually sits); both were corrected together.
 */
export interface StateDumpEvent {
  /**
   * Active training mode at payload offset 0 (raw byte; 0 = transitional
   * mid-mode-switch, 1 = WeightTraining, 2 = ResistanceBand). The numeric
   * values align with the {@link TrainingMode} enum but the byte is exposed
   * verbatim — the encoded byte is uint8, while `TrainingMode` is uint16 LE.
   * Consumers that want the typed enum should narrow with the enum's
   * numeric values.
   */
  trainingMode: TrainingMode;
  /** Fitness-assist toggle at payload offset 1 (0 or 0x02). */
  assistMode: number;
  /**
   * Active weight setting in tenths of pounds (uint16 LE) at payload
   * offset 3. Mirrors the cmd=0x10 cascade `baseWeight` × 10. Zero in
   * non-WeightTraining modes.
   */
  weightLbsTenths: number;
  /**
   * Effective chain target force at the cable in tenths of pounds (uint16
   * LE) at payload offset 5. Equals `min(chains, weight) × 10` — the device
   * silently caps the chain setting at the active weight. Use the cmd=0x10
   * cascade `chains` field for the user-set chain value.
   */
  chainTargetForceTenths: number;
  /**
   * Eccentric overload setting in tenths of percent (uint16 LE) at payload
   * offset 7. Mirrors the cmd=0x10 cascade `eccentric` × 10.
   */
  eccentricPercentTenths: number;
  /** Raw 37-byte payload after the `aa 80 25` sub-type prefix (excludes CRC). */
  raw: Uint8Array;
}

// <Decoder-cmd07-cmd10> ==========================================================
// Rowing telemetry payload types. Field offsets follow the Android-deep-dive
// audit (`rowing-protocol-2026-05-06-android-deep.md` §4 + `aa-subtype-catalog
// -2026-05-07-android-deep.md` §7.7 / §7.9). All fields are HYPOTHESIS until
// on-device validation in a future Rowing-mode session — the prior on-device
// session (Bug 22) was unable to engage Rowing mode successfully.
// ==========================================================
/**
 * Decoded rowing summary frame (`0xAA 0x95 0x25`).
 *
 * Pace is stored on-wire as **tenths of seconds per 500 m** (uint32 LE);
 * multiply by 100 to convert to milliseconds. Distance is in **meters**.
 */
export interface RowingSummaryEvent {
  /** Stroke rate (strokes per minute) at payload offset 2. */
  strokeRateSpm: number;
  /** Current 500 m pace in milliseconds (decoded from tenths-of-seconds). */
  currentPaceMs: number;
  /** Average 500 m pace in milliseconds (decoded from tenths-of-seconds). */
  averagePaceMs: number;
  /** Stroke count (Android stores ×100; reported here as whole strokes). */
  strokeCount: number;
  /** Distance in meters (uint32 LE at payload offset 35..38). */
  distanceMeters: number;
  /** Raw payload following the `aa 95 25` sub-type prefix (excludes CRC). */
  raw: Uint8Array;
}

/**
 * Decoded rowing status frame (`0xAA 0x92 ...`).
 *
 * Distance is stored on-wire in **centimeters** (uint32 LE); decoder converts
 * to meters. Different unit from `0xAA 0x95 0x25` distance.
 */
export interface RowingStatusEvent {
  /** Stroke-rate fallback (uint8 SPM) at payload offset 2. */
  strokeRateSpm: number;
  /** Distance in meters (decoded from centimeters at payload offset 11..14). */
  distanceMeters: number;
  /** Raw payload following the `aa 92` sub-type byte (excludes CRC). */
  raw: Uint8Array;
}

/**
 * Decoded rowing/isometric waveform chunk (`0xAA 0x93 <variant>`).
 *
 * In rowing mode each sample is a force value in **tenths of pounds** (NOT
 * Newtons — the isometric-mode parser scales tenths-lb by `LB_TO_NEWTONS`,
 * but rowing samples are reported as tenths-lb directly).
 *
 * `chunkIndex` lets the consumer reassemble multi-chunk waveforms; reset rule
 * follows Android (`chunkIndex <= 1 || chunkIndex <= lastChunkIndex` resets
 * the buffer).
 */
export interface WaveformChunkEvent {
  /** Variant marker byte (`0xCC`, `0x82`, or `0xA8`) at payload offset 1. */
  variant: number;
  /** Chunk index (uint8) at payload offset 2. */
  chunkIndex: number;
  /** Number of declared samples (uint16 LE at payload offset 4..5). */
  declaredSampleCount: number;
  /** Decoded samples (uint16 LE) starting at payload offset 6. */
  samples: Uint16Array;
  /** Sample unit (informational). */
  sampleUnit: 'tenths-of-pounds';
  /** Raw payload following the `aa 93` sub-type byte (excludes CRC). */
  raw: Uint8Array;
}

/**
 * Single decoded parameter from a `cmd=0x10` async-state cascade frame.
 */
export interface Cmd10Param {
  /** Parameter ID as a 4-char hex string (little-endian on the wire). */
  paramIdHex: string;
  /** Decoded value (uint8 or uint16 depending on `paramIdHex`). */
  value: number;
  /** Width of the value field in bytes (1 or 2). */
  byteLength: 1 | 2;
}

/**
 * Decoded `cmd=0x10` async-state cascade frame.
 *
 * `frame[10]` = `0x10` (async-state cmd byte).
 * `frame[11]` = paramCount (= inner-cmd discriminator from the runbook):
 *   - `0x01` = single-param update (frame length 18 for uint8 value, 19 for
 *     uint16 value).
 *   - `0x02` = structural / mode-switch update (typically two params; e.g.,
 *     `0x3e89` + `0x4fb0` together).
 *   - `0x09` = full-state cascade (9 params, frame length 46 = canonical
 *     `settingsUpdate`).
 * `frame[12]` = 0x00 (reserved).
 * `frame[13..]` = `<paramID-LE><value>` repeated `paramCount` times.
 */
export interface Cmd10AsyncState {
  /** Paramater count (frame[11]); also serves as the inner-cmd discriminator. */
  paramCount: number;
  /** Decoded parameters in wire order. */
  params: Cmd10Param[];
}

// <Bug-17> Begin — cmd=0x0F bulk-read response payload (additive, do not modify).
/**
 * Parsed cmd=0x0F bulk-read response.
 *
 * The device returns one of these in response to bootstrap step 10 (the
 * 18-param mode-feature-state query) and to any other multi-paramID read.
 * The payload structure is `[count(u16 LE), ...(paramId(u16 LE) + value)]`
 * where the value width depends on the paramId — currently the SDK decodes
 * the same fields as `settings_update` (`baseWeight`, `chains`, `eccentric`,
 * `trainingMode`, `inverseChains`, `damperLevel`) and ignores params with
 * unknown widths. See `voltra-private/research/data-port-2026-05-07-android-deep.md`
 * § 4 for the open question on per-paramId value-width tables.
 */
export interface Cmd0x0FBulkResponse {
  /** Number of paramId+value pairs successfully parsed */
  paramCount: number;
  /** Decoded device settings extracted from the response */
  settings: DeviceSettings;
}
// <Bug-17> End
