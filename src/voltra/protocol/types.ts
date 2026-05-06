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
  /** Pre-summary frame (110 B). Fires once near workout end. */
  preSummary: VendorSubTypeConfig;
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
  /** Unknown parameter observed in notifications */
  unknown893e: string;
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
}
