/**
 * Training mode profile definitions.
 *
 * Maps each TrainingMode to its kinematics profile: phase structure,
 * max position, and mode-specific constants or custom builder.
 */

import { MovementPhase, TrainingMode } from '../../../voltra/protocol/constants/enums';
import type { KinematicsProfile, PhaseDef } from './types';
import {
  standardProfile,
  damperBuildValues,
  isokineticBuildValues,
  isometricBuildValues,
} from './kinematics';

const STANDARD_PHASES: PhaseDef[] = [
  { phase: MovementPhase.IDLE, count: 5 },
  { phase: MovementPhase.CONCENTRIC, count: 9 },
  { phase: MovementPhase.HOLD, count: 2 },
  { phase: MovementPhase.ECCENTRIC, count: 16 },
];

const WEIGHT_TRAINING_PROFILE = standardProfile(STANDARD_PHASES, 600, {
  concentricVelocityPeak: 80,
  eccentricVelocityPeak: 40,
  holdForceMultiplier: 0.5,
  concentricForce: (p, bf, f) => bf * (1 - p * 0.3) * f,
  eccentricForce: (p, bf, f) => bf * 0.8 * (1 - p * 0.2) * f,
});

export const KINEMATICS_PROFILES: Record<TrainingMode, KinematicsProfile> = {
  [TrainingMode.Idle]: WEIGHT_TRAINING_PROFILE,
  [TrainingMode.WeightTraining]: WEIGHT_TRAINING_PROFILE,

  [TrainingMode.ResistanceBand]: standardProfile(
    [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 10 },
      { phase: MovementPhase.HOLD, count: 3 },
      { phase: MovementPhase.ECCENTRIC, count: 14 },
    ],
    650,
    {
      concentricVelocityPeak: 70,
      eccentricVelocityPeak: 35,
      holdForceMultiplier: 0.9,
      concentricForce: (p, bf, f) => bf * (0.4 + p * 0.6) * f,
      eccentricForce: (p, bf, f) => bf * (1.0 - p * 0.6) * f,
    }
  ),

  [TrainingMode.Rowing]: standardProfile(
    [
      { phase: MovementPhase.IDLE, count: 6 },
      { phase: MovementPhase.CONCENTRIC, count: 14 },
      { phase: MovementPhase.HOLD, count: 2 },
      { phase: MovementPhase.ECCENTRIC, count: 20 },
    ],
    700,
    {
      concentricVelocityPeak: 50,
      eccentricVelocityPeak: 25,
      holdForceMultiplier: 0.3,
      concentricForce: (p, bf, f) => bf * Math.exp(-p * 0.5) * f,
      eccentricForce: (_p, bf, f) => bf * 0.4 * f,
    }
  ),

  [TrainingMode.Damper]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 10 },
      { phase: MovementPhase.HOLD, count: 2 },
      { phase: MovementPhase.ECCENTRIC, count: 14 },
    ],
    maxPosition: 600,
    buildValues: damperBuildValues,
  },

  [TrainingMode.CustomCurves]: standardProfile(
    [
      { phase: MovementPhase.IDLE, count: 4 },
      { phase: MovementPhase.CONCENTRIC, count: 11 },
      { phase: MovementPhase.HOLD, count: 3 },
      { phase: MovementPhase.ECCENTRIC, count: 15 },
    ],
    550,
    {
      concentricVelocityPeak: 65,
      eccentricVelocityPeak: 32,
      holdForceMultiplier: 0.5,
      concentricForce: (p, bf, f) => bf * Math.sin(p * Math.PI) * f,
      eccentricForce: (p, bf, f) => bf * Math.sin(p * Math.PI) * 0.8 * f,
    }
  ),

  [TrainingMode.Isokinetic]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 12 },
      { phase: MovementPhase.HOLD, count: 2 },
      { phase: MovementPhase.ECCENTRIC, count: 12 },
    ],
    maxPosition: 600,
    buildValues: isokineticBuildValues,
  },

  [TrainingMode.Isometric]: {
    phases: [
      { phase: MovementPhase.IDLE, count: 5 },
      { phase: MovementPhase.CONCENTRIC, count: 20 },
    ],
    maxPosition: 0,
    buildValues: isometricBuildValues,
  },
};
