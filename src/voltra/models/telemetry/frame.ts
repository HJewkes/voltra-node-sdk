/**
 * Telemetry Frame Model
 *
 * Represents a single telemetry data point from the Voltra device.
 */

import { MovementPhase } from '../../protocol/constants';

/**
 * Real-time telemetry data from a single BLE notification.
 * Received at ~11 Hz during active workouts.
 */
export interface TelemetryFrame {
  /** Incrementing sequence number from device */
  sequence: number;
  /** Current movement phase */
  phase: MovementPhase;
  /** Cable extension (0=rest, ~600=full pull) */
  position: number;
  /** Force reading in lbs (positive=concentric, negative=eccentric) */
  force: number;
  /** Movement velocity */
  velocity: number;
  /** When frame was received (ms since epoch) */
  timestamp: number;
}

/**
 * Create a telemetry frame from parsed values.
 */
export function createFrame(
  sequence: number,
  phase: MovementPhase,
  position: number,
  force: number,
  velocity: number
): TelemetryFrame {
  return {
    sequence,
    phase,
    position,
    force,
    velocity,
    timestamp: Date.now(),
  };
}

/**
 * Check if a frame represents active movement.
 */
export function isActivePhase(frame: TelemetryFrame): boolean {
  return (
    frame.phase === MovementPhase.CONCENTRIC ||
    frame.phase === MovementPhase.ECCENTRIC ||
    frame.phase === MovementPhase.HOLD
  );
}

/**
 * Check if frame is concentric (pulling) phase.
 */
export function isConcentricPhase(frame: TelemetryFrame): boolean {
  return frame.phase === MovementPhase.CONCENTRIC;
}

/**
 * Check if frame is eccentric (lowering) phase.
 */
export function isEccentricPhase(frame: TelemetryFrame): boolean {
  return frame.phase === MovementPhase.ECCENTRIC;
}
