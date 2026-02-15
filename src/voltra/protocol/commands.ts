/**
 * Voltra Protocol Commands
 *
 * Simple key-value mapping from operations to commands.
 * Commands are loaded from the consolidated protocol.json.
 * All commands are pre-computed lookup values.
 */

import { hexToBytes } from '../../shared/utils';
import { TrainingMode, VALID_TRAINING_MODES } from './constants';
import protocolData from './data/protocol-data.generated';
import type { ProtocolData } from './types';

// Type the imported data
const protocol = protocolData as ProtocolData;

// =============================================================================
// Command Maps (initialized from protocol.json)
// =============================================================================

/** Weight commands map (5-200 lbs) */
const weightCommands: Record<number, Uint8Array> = {};

/** Chains commands map (0-100 lbs) */
const chainsCommands: Record<number, Uint8Array> = {};

/** Eccentric commands map (-195 to +195) */
const eccentricCommands: Record<number, Uint8Array> = {};

/** Inverse chains commands map (0-100 lbs) */
const inverseChainsCommands: Record<number, Uint8Array> = {};

// Initialize from consolidated protocol.json
for (const [lbs, hex] of Object.entries(protocol.commands.weights)) {
  weightCommands[Number(lbs)] = hexToBytes(hex);
}

for (const [lbs, hex] of Object.entries(protocol.commands.chains)) {
  chainsCommands[Number(lbs)] = hexToBytes(hex);
}

for (const [value, hex] of Object.entries(protocol.commands.eccentric)) {
  eccentricCommands[Number(value)] = hexToBytes(hex);
}

for (const [lbs, hex] of Object.entries(protocol.commands.inverseChains)) {
  inverseChainsCommands[Number(lbs)] = hexToBytes(hex);
}

// =============================================================================
// Lookup Functions
// =============================================================================

/**
 * Get weight command for specified pounds.
 * @param lbs Weight in pounds (5-200)
 * @returns Command bytes, or null if not available
 */
export function getWeightCommand(lbs: number): Uint8Array | null {
  return weightCommands[lbs] || null;
}

/**
 * Get chains command for specified pounds.
 * @param lbs Chains weight in pounds (0-100)
 * @returns Command bytes, or null if not available
 */
export function getChainsCommand(lbs: number): Uint8Array | null {
  return chainsCommands[lbs] || null;
}

/**
 * Get eccentric command for specified value.
 * @param value Eccentric adjustment (-195 to +195)
 * @returns Command bytes, or null if not available
 */
export function getEccentricCommand(value: number): Uint8Array | null {
  return eccentricCommands[value] || null;
}

/**
 * Get available weight values.
 */
export function getAvailableWeights(): number[] {
  return Object.keys(weightCommands)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Get available chains values.
 */
export function getAvailableChains(): number[] {
  return Object.keys(chainsCommands)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Get available eccentric values.
 */
export function getAvailableEccentric(): number[] {
  return Object.keys(eccentricCommands)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Get inverse chains command for specified pounds.
 * @param lbs Inverse chains weight in pounds (0-100)
 * @returns Command bytes, or null if not available
 */
export function getInverseChainsCommand(lbs: number): Uint8Array | null {
  return inverseChainsCommands[lbs] || null;
}

/**
 * Get available inverse chains values.
 */
export function getAvailableInverseChains(): number[] {
  return Object.keys(inverseChainsCommands)
    .map(Number)
    .sort((a, b) => a - b);
}

// =============================================================================
// Mode Setting Commands
// =============================================================================

/** Mode commands map (TrainingMode -> Uint8Array) */
const modeCommands: Map<TrainingMode, Uint8Array> = new Map([
  [TrainingMode.Idle, hexToBytes(protocol.commands.modes.idle)],
  [TrainingMode.WeightTraining, hexToBytes(protocol.commands.modes.weightTraining)],
  [TrainingMode.ResistanceBand, hexToBytes(protocol.commands.modes.resistanceBand)],
  [TrainingMode.Rowing, hexToBytes(protocol.commands.modes.rowing)],
  [TrainingMode.Damper, hexToBytes(protocol.commands.modes.damper)],
  [TrainingMode.CustomCurves, hexToBytes(protocol.commands.modes.customCurves)],
  [TrainingMode.Isokinetic, hexToBytes(protocol.commands.modes.isokinetic)],
  [TrainingMode.Isometric, hexToBytes(protocol.commands.modes.isometric)],
]);

/**
 * Get mode command for specified training mode.
 * @param mode Training mode to set
 * @returns Command bytes, or null if invalid mode
 */
export function getModeCommand(mode: TrainingMode): Uint8Array | null {
  return modeCommands.get(mode) || null;
}

/**
 * Get available training modes.
 */
export function getAvailableModes(): TrainingMode[] {
  return [...VALID_TRAINING_MODES];
}
