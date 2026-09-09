/**
 * Kinematics computation engines for mock telemetry simulation.
 *
 * Standard modes share a parameterized computation via ModeConstants.
 * Modes with fundamentally different physics use custom builders.
 */

import { MovementPhase } from '../../../voltra/protocol/constants/enums';
import type { KinematicsValues, KinematicsProfile, ModeConstants, PhaseDef } from './types';

/**
 * Velocity constants in this file (ModeConstants fields and the damper/isokinetic
 * builders' inline peaks) are authored in cm/s, the unit the vendor's own
 * `InProgressEvent.velocityCmPerSec` field uses. The telemetry frame's `velocity`
 * is mm/s (see protocol/telemetry-decoder.ts's `decodeTelemetryFrame` comment), so
 * every velocity computed here is scaled by this cm-to-mm factor before it is
 * returned.
 */
export const VELOCITY_UNIT_FACTOR = 10;

function buildStandardValues(
  constants: ModeConstants,
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  maxPosition: number
): KinematicsValues {
  switch (phase) {
    case MovementPhase.CONCENTRIC:
      return {
        position: Math.round(progress * maxPosition),
        velocity: Math.round(
          Math.sin(progress * Math.PI) *
            constants.concentricVelocityPeak *
            VELOCITY_UNIT_FACTOR *
            fatigue
        ),
        force: Math.round(constants.concentricForce(progress, baseForce, fatigue)),
      };
    case MovementPhase.HOLD:
      return {
        position: maxPosition,
        velocity: 0,
        force: Math.round(baseForce * constants.holdForceMultiplier),
      };
    case MovementPhase.ECCENTRIC:
      return {
        position: Math.round((1 - progress) * maxPosition),
        velocity: Math.round(
          Math.sin(progress * Math.PI) *
            constants.eccentricVelocityPeak *
            VELOCITY_UNIT_FACTOR *
            fatigue
        ),
        force: Math.round(constants.eccentricForce(progress, baseForce, fatigue)),
      };
    default:
      return { position: 0, velocity: 0, force: 0 };
  }
}

export function standardProfile(
  phases: PhaseDef[],
  maxPosition: number,
  constants: ModeConstants
): KinematicsProfile {
  return {
    phases,
    maxPosition,
    buildValues: (phase, progress, fatigue, baseForce, maxPos) =>
      buildStandardValues(constants, phase, progress, fatigue, baseForce, maxPos),
  };
}

/** Damper: force depends on computed velocity, not a standard force curve */
export function damperBuildValues(
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  maxPosition: number
): KinematicsValues {
  switch (phase) {
    case MovementPhase.CONCENTRIC: {
      // rawVelocity is the cm/s magnitude the force curve is calibrated
      // against; only the emitted velocity is scaled to the frame's mm/s
      // (see VELOCITY_UNIT_FACTOR).
      const rawVelocity = Math.round(Math.sin(progress * Math.PI) * 75 * fatigue);
      return {
        position: Math.round(progress * maxPosition),
        velocity: rawVelocity * VELOCITY_UNIT_FACTOR,
        force: Math.round(rawVelocity * baseForce * 0.02 * fatigue),
      };
    }
    case MovementPhase.HOLD:
      return { position: maxPosition, velocity: 0, force: Math.round(baseForce * 0.1) };
    case MovementPhase.ECCENTRIC: {
      const rawVelocity = Math.round(Math.sin(progress * Math.PI) * 38 * fatigue);
      return {
        position: Math.round((1 - progress) * maxPosition),
        velocity: rawVelocity * VELOCITY_UNIT_FACTOR,
        force: Math.round(rawVelocity * baseForce * 0.015 * fatigue),
      };
    }
    default:
      return { position: 0, velocity: 0, force: 0 };
  }
}

/** Isokinetic: constant velocity, variable force */
export function isokineticBuildValues(
  phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  maxPosition: number
): KinematicsValues {
  // 45 cm/s, scaled to the frame's mm/s (see VELOCITY_UNIT_FACTOR).
  const constantVelocity = 45 * VELOCITY_UNIT_FACTOR;
  switch (phase) {
    case MovementPhase.CONCENTRIC:
      return {
        position: Math.round(progress * maxPosition),
        velocity: constantVelocity,
        force: Math.round(baseForce * (0.8 + Math.sin(progress * Math.PI) * 0.4) * fatigue),
      };
    case MovementPhase.HOLD:
      return { position: maxPosition, velocity: 0, force: Math.round(baseForce * 0.6) };
    case MovementPhase.ECCENTRIC:
      return {
        position: Math.round((1 - progress) * maxPosition),
        velocity: constantVelocity,
        force: Math.round(baseForce * (0.6 + Math.sin(progress * Math.PI) * 0.3) * fatigue),
      };
    default:
      return { position: 0, velocity: 0, force: 0 };
  }
}

/** Isometric: no movement, pure force output */
export function isometricBuildValues(
  _phase: MovementPhase,
  progress: number,
  fatigue: number,
  baseForce: number,
  _maxPosition: number
): KinematicsValues {
  return {
    position: 0,
    velocity: 0,
    force: Math.round(baseForce * (0.7 + Math.sin(progress * Math.PI * 2) * 0.3) * fatigue),
  };
}
