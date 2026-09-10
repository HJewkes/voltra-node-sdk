/**
 * Protocol Enums
 *
 * Movement phases, training modes, and parameter IDs with
 * their human-readable name maps.
 */

// =============================================================================
// Movement Phases
// =============================================================================

/**
 * Movement phase during workout.
 * Values match protocol.json telemetry.phases.
 */
export enum MovementPhase {
  IDLE = 0, // protocol.telemetry.phases.idle
  CONCENTRIC = 1, // protocol.telemetry.phases.concentric - Pulling (muscle shortening)
  HOLD = 2, // protocol.telemetry.phases.hold - Top of rep / transition
  ECCENTRIC = 3, // protocol.telemetry.phases.eccentric - Releasing (muscle lengthening)
  UNKNOWN = -1,
}

/**
 * Human-readable phase names.
 */
export const PhaseNames: Record<MovementPhase, string> = {
  [MovementPhase.IDLE]: 'Idle',
  [MovementPhase.CONCENTRIC]: 'Pulling',
  [MovementPhase.HOLD]: 'Hold',
  [MovementPhase.ECCENTRIC]: 'Lowering',
  [MovementPhase.UNKNOWN]: 'Unknown',
};

// =============================================================================
// Parameter IDs
// =============================================================================

/**
 * Parameter IDs for device commands.
 * These identify which parameter is being set in a parametric command.
 */
export enum ParameterId {
  /** Base weight setting */
  BASE_WEIGHT = 0x863e,
  /** Chains resistance */
  CHAINS = 0x873e,
  /** Eccentric adjustment */
  ECCENTRIC = 0x883e,
  /** Training mode */
  TRAINING_MODE = 0xb04f,
  /** Inverse chains resistance */
  INVERSE_CHAINS = 0xb053,
}

/**
 * Human-readable parameter names.
 */
export const ParameterNames: Record<ParameterId, string> = {
  [ParameterId.BASE_WEIGHT]: 'Base Weight',
  [ParameterId.CHAINS]: 'Chains',
  [ParameterId.ECCENTRIC]: 'Eccentric',
  [ParameterId.TRAINING_MODE]: 'Training Mode',
  [ParameterId.INVERSE_CHAINS]: 'Inverse Chains',
};

// =============================================================================
// Training Modes
// =============================================================================

/**
 * Training mode values for ParameterId.TRAINING_MODE.
 * Values are 2-byte little-endian uint16.
 */
export enum TrainingMode {
  /** Idle */
  Idle = 0x0000,
  /** Weight Training */
  WeightTraining = 0x0001,
  /** Resistance Band */
  ResistanceBand = 0x0002,
  /** Rowing */
  Rowing = 0x0003,
  /** Damper */
  Damper = 0x0004,
  /** Custom Curves */
  CustomCurves = 0x0006,
  /** Isokinetic */
  Isokinetic = 0x0007,
  /** Isometric */
  Isometric = 0x0008,
}

/**
 * Human-readable training mode names.
 */
export const TrainingModeNames: Record<TrainingMode, string> = {
  [TrainingMode.Idle]: 'Idle',
  [TrainingMode.WeightTraining]: 'Weight Training',
  [TrainingMode.ResistanceBand]: 'Resistance Band',
  [TrainingMode.Rowing]: 'Rowing',
  [TrainingMode.Damper]: 'Damper',
  [TrainingMode.CustomCurves]: 'Custom Curves',
  [TrainingMode.Isokinetic]: 'Isokinetic',
  [TrainingMode.Isometric]: 'Isometric',
};

/**
 * Valid training mode values (for validation).
 */
export const VALID_TRAINING_MODES: readonly TrainingMode[] = [
  TrainingMode.Idle,
  TrainingMode.WeightTraining,
  TrainingMode.ResistanceBand,
  TrainingMode.Rowing,
  TrainingMode.Damper,
  TrainingMode.CustomCurves,
  TrainingMode.Isokinetic,
  TrainingMode.Isometric,
] as const;

// =============================================================================
// Vendor Schema Versions
// =============================================================================

/**
 * Per-mode schema version carried as the 4th sub-type byte of vendor
 * `summary` and `setSummary` frames, after the vendor cmd and its fixed
 * fixed identifier. Validated on-device 2026-05-06.
 */
export enum VendorSchemaVersion {
  Weight = 0x01,
  Band = 0x02,
  Damper = 0x03,
  Isokinetic = 0x04,
}
