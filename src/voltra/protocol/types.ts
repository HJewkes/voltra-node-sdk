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
  /** Idle mode */
  idle: string;
  /** Weight training mode */
  weightTraining: string;
  /** Resistance band mode */
  resistanceBand: string;
  /** Rowing mode */
  rowing: string;
  /** Damper mode */
  damper: string;
  /** Custom curves mode */
  customCurves: string;
  /** Isokinetic mode */
  isokinetic: string;
  /** Isometric mode */
  isometric: string;
}

/**
 * Authentication device IDs.
 */
export interface AuthCommands {
  /** iPhone device ID string. */
  iphone: string;
  /** iPad device ID string. */
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
  /** Message type identifiers */
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
  /**
   * Generated parameter catalog keyed by `wireLE` (the form inbound
   * async-state / bulk-read cascade decoders match against). Source-of-truth
   * for paramID metadata — supersedes the hand-authored
   * `KNOWN_PARAM_WIDTHS` lookup in `telemetry-decoder.ts`.
   *
   * Emitted by the protocol-data generator. Optional for backward compat
   * with older protocol-data versions.
   */
  parameterCatalog?: Record<string, ParameterCatalogEntry>;
  /** Training mode values */
  trainingModes: TrainingModesConfig;
  /** Vendor frame sub-type definitions */
  vendorMessages: VendorMessagesConfig;
}

/**
 * Single parameter entry in the generated catalog. Mirrors the generator's
 * parameter definition minus the runtime `encode`/`decode` functions (which
 * can't be JSON-serialized through the base64 protocol-data pipeline).
 */
export interface ParameterCatalogEntry {
  /** Canonical 16-bit paramID for the register named by `name`. */
  paramId: number;
  /** Canonical register name. */
  name: string;
  /** Big-endian wire form (4-char lowercase hex; outbound writes). */
  wireBE: string;
  /** Little-endian wire form (4-char lowercase hex; inbound matches). */
  wireLE: string;
  /** Underlying primitive value type (drives decoder dispatch). */
  valueType: 'uint8' | 'uint16' | 'int16' | 'uint32' | 'int32';
  /** Byte width on the wire for the value field. */
  valueWidth: 1 | 2 | 4;
  /** Human-readable unit (e.g. `lbs`, `mm/s`, `enum`). */
  unit: string;
  /** Voltra register-prefix subtree. */
  register:
    | 'bp'
    | 'fitness'
    | 'ep'
    | 'isokinetic'
    | 'isometric'
    | 'resistance'
    | 'weight-training'
    | 'mc'
    | 'bms'
    | 'ble'
    | 'unknown';
  /** Provenance + confidence label. */
  validation: 'device-validated' | 'android-only' | 'hypothesis' | 'mislabeled' | 'unknown';
}

/**
 * Message type header bytes (hex strings).
 *
 * On-device validation (2026-05-05, 1369 frames) confirmed that
 * the previously-documented `repSummary`, `setSummary`, and `statusUpdate`
 * signatures were aliases for vendor sub-type frames (perRep,
 * inProgress) and the statusBattery notification respectively.
 * They were collapsed into a single classification path; only the
 * telemetry stream remains as a distinct signature.
 */
export interface MessageTypeConfig {
  /** Real-time telemetry stream (~11 Hz) */
  stream: string;
}

/**
 * Vendor frame sub-type definitions.
 *
 * Each entry names a vendor frame family and the sub-type it is matched by.
 */
export interface VendorMessagesConfig {
  /** Byte offset of the vendor cmd marker within the frame */
  cmdByteOffset: number;
  /** Vendor cmd marker value */
  cmdValue: number;
  /** Documented sub-type frames */
  subTypes: VendorSubTypesConfig;
}

export interface VendorSubTypesConfig {
  /** Per-rep boundary frame. Fires at pull start and return start. */
  perRep: VendorSubTypeConfig;
  /** End-of-workout summary frame. Fires once after STOP. */
  summary: VendorSubTypeConfig;
  /** Recurring in-progress telemetry. Was previously aliased as setSummary. */
  inProgress: VendorSubTypeConfig;
  /**
   * Set-summary frame. Device emits one per set in
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
   * Only present on `summary` and `setSummary`, whose sub-type is
   * the vendor cmd, a fixed identifier, then this byte.
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
  /** Sequence number */
  sequence: number;
  /** Movement phase */
  phase: number;
  /** Position, in millimetres */
  position: number;
  /** Force, in tenths of pounds */
  force: number;
  /** Velocity, in mm/s */
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
  /** Mode change confirmation */
  modeConfirmation: NotificationTypeConfig;
  /** Multi-parameter message */
  multiParam: NotificationTypeConfig;
  /** Settings update with all parameters */
  settingsUpdate: NotificationTypeConfig;
  /** Device initialization info */
  deviceInit: NotificationTypeConfig;
  /** Status/battery update */
  statusBattery: NotificationTypeConfig;
}

/**
 * Known parameter IDs (hex strings, little-endian).
 */
export interface ParamIdsConfig {
  /** Base weight parameter */
  baseWeight: string;
  /** Chains weight parameter */
  chains: string;
  /** Eccentric setting parameter */
  eccentric: string;
  /** Training mode parameter */
  trainingMode: string;
  /** Inverse chains parameter */
  inverseChains: string;
  /**
   * The workout-state register controlling the device's primary mode/state
   * machine, across the strength, direct-load and rowing flows.
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
   * Reflected when the damperLevel paramId is present in a settings_update
   * notification.
   */
  damperLevel?: number;
}

// <Decoder-statedump-asyncstate> ==========================================================
// State-dump parsed payload.
//
// Field offsets validated on-device 2026-05-07. The earlier "variable-layout
// / discriminator byte" hypothesis was disproved: the payload has a fixed
// layout across every observed (trainingMode × assistMode × transition)
// combination. Only fields stable across the observed frames are exposed.
// ==========================================================
/**
 * Parsed state-dump frame.
 *
 * Field semantics validated on-device (2026-05-07). Earlier decoder
 * versions mislabelled `trainingMode` as
 * `chainsActive` and read `chainTargetForceTenths` from the wrong offset
 * (where weight-in-tenths actually sits); both were corrected together.
 */
export interface StateDumpEvent {
  /**
   * Active training mode, exposed as the raw byte. A zero means the device
   * is mid-mode-switch. The values align with the {@link TrainingMode} enum,
   * but the byte is uint8 on the wire while `TrainingMode` is uint16 LE, so
   * consumers wanting the typed enum should narrow with the enum's values.
   */
  trainingMode: TrainingMode;
  /** Fitness-assist toggle. */
  assistMode: number;
  /**
   * Active weight setting in tenths of pounds (uint16 LE). Mirrors the
   * async-state cascade `baseWeight` × 10. Zero in non-WeightTraining modes.
   */
  weightLbsTenths: number;
  /**
   * Effective chain target force at the cable in tenths of pounds (uint16
   * LE). Equals `min(chains, weight) × 10` — the device silently caps the
   * chain setting at the active weight. Use the async-state cascade `chains`
   * field for the user-set chain value.
   */
  chainTargetForceTenths: number;
  /**
   * Eccentric overload setting in tenths of percent (uint16 LE). Mirrors
   * the async-state cascade `eccentric` × 10.
   */
  eccentricPercentTenths: number;
  /** Raw payload bytes (excludes the CRC trailer). */
  raw: Uint8Array;
}

// <Decoder-statedump-asyncstate> ==========================================================
// Rowing telemetry payload types. All fields are HYPOTHESIS until
// on-device validation in a future Rowing-mode session — the prior on-device
// session (Bug 22) was unable to engage Rowing mode successfully.
// ==========================================================
/**
 * Decoded rowing summary frame.
 *
 * Pace is reported in **milliseconds per 500 m** and distance in **meters**.
 */
export interface RowingSummaryEvent {
  /** Stroke rate in strokes per minute. */
  strokeRateSpm: number;
  /** Current 500 m pace in milliseconds. */
  currentPaceMs: number;
  /** Average 500 m pace in milliseconds. */
  averagePaceMs: number;
  /** Stroke count, reported as whole strokes. */
  strokeCount: number;
  /** Distance in meters. */
  distanceMeters: number;
  /** Raw payload bytes (excludes the CRC trailer). */
  raw: Uint8Array;
}

/**
 * Decoded rowing status frame.
 *
 * Distance is reported in **meters**, converted by the decoder from the
 * finer unit this frame uses.
 */
export interface RowingStatusEvent {
  /** Stroke-rate fallback, in strokes per minute. */
  strokeRateSpm: number;
  /** Distance in meters. */
  distanceMeters: number;
  /** Raw payload following the sub-type byte (excludes CRC). */
  raw: Uint8Array;
}

/**
 * Decoded rowing/isometric waveform chunk.
 *
 * In rowing mode each sample is a force value in **tenths of pounds** (NOT
 * Newtons — the isometric-mode parser converts to newtons, but rowing
 * samples are reported as tenths-lb directly).
 *
 * `chunkIndex` lets the consumer reassemble multi-chunk waveforms. Reset the
 * buffer whenever the index fails to advance.
 */
export interface WaveformChunkEvent {
  /** Variant marker byte distinguishing isometric from rowing. */
  variant: number;
  /** Chunk index (uint8). */
  chunkIndex: number;
  /** Number of declared samples (uint16 LE). */
  declaredSampleCount: number;
  /** Decoded samples (uint16 LE). */
  samples: Uint16Array;
  /** Sample unit (informational). */
  sampleUnit: 'tenths-of-pounds';
  /** Raw payload following the sub-type byte (excludes CRC). */
  raw: Uint8Array;
}

/**
 * Single decoded parameter from a async-state cascade frame.
 */
export interface AsyncStateParam {
  /** Parameter ID as a 4-char hex string (little-endian on the wire). */
  paramIdHex: string;
  /** Decoded value (uint8 or uint16 depending on `paramIdHex`). */
  value: number;
  /** Width of the value field in bytes (1 or 2). */
  byteLength: 1 | 2;
}

/**
 * Decoded async-state cascade frame.
 *
 * The param count doubles as a discriminator: one param is a single-setting
 * update, two is a structural / mode-switch update, and a full cascade
 * carries the whole settings bag.
 */
export interface AsyncStateFrame {
  /** Parameter count; also serves as the inner-cmd discriminator. */
  paramCount: number;
  /** Decoded parameters in wire order. */
  params: AsyncStateParam[];
}

// <Bug-17> Begin — bulk-read response payload (additive, do not modify).
/**
 * Parsed bulk-read response.
 *
 * The device returns one of these in response to bootstrap step 10 (the
 * 18-param mode-feature-state query) and to any other multi-paramID read.
 * The response carries a set of paramId/value pairs whose value widths vary
 * by paramId. The SDK decodes the same fields as `settings_update`
 * (`baseWeight`, `chains`, `eccentric`, `trainingMode`, `inverseChains`,
 * `damperLevel`) and ignores params with unknown widths. Per-paramId value-width tables remain an open question.
 */
export interface BulkParamResponse {
  /** Number of paramId+value pairs successfully parsed */
  paramCount: number;
  /** Decoded device settings extracted from the response */
  settings: DeviceSettings;
}
// <Bug-17> End
