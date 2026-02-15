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
}

/**
 * Message type header bytes (4-byte hex strings).
 */
export interface MessageTypeConfig {
  /** Real-time telemetry stream (~11 Hz) */
  stream: string;
  /** Rep completion summary */
  repSummary: string;
  /** Set completion summary */
  setSummary: string;
  /** Status update */
  statusUpdate: string;
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
