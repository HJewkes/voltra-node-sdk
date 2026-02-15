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
 * These identify which parameter is being set in 19-byte commands.
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
  /** Idle (0x0000) */
  Idle = 0x0000,
  /** Weight Training (0x0001) */
  WeightTraining = 0x0001,
  /** Resistance Band (0x0002) */
  ResistanceBand = 0x0002,
  /** Rowing (0x0003) */
  Rowing = 0x0003,
  /** Damper (0x0004) */
  Damper = 0x0004,
  /** Custom Curves (0x0006) */
  CustomCurves = 0x0006,
  /** Isokinetic (0x0007) */
  Isokinetic = 0x0007,
  /** Isometric (0x0008) */
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
