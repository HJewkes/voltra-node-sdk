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

// =============================================================================
// Mode-Config Setter Commands (added in 0.6.0)
// =============================================================================

/** Damper level commands (0-9; UI displays N+1) */
const damperLevelCommands: Record<number, Uint8Array> = {};
for (const [level, hex] of Object.entries(protocol.commands.damperLevel)) {
  damperLevelCommands[Number(level)] = hexToBytes(hex);
}

/** Assist mode commands ('off' | 'on') */
const assistModeCommands: Record<string, Uint8Array> = {};
for (const [mode, hex] of Object.entries(protocol.commands.assistMode)) {
  assistModeCommands[mode] = hexToBytes(hex);
}

/** Resistance band max force commands (lbs) */
const bandMaxForceCommands: Record<number, Uint8Array> = {};
for (const [lbs, hex] of Object.entries(protocol.commands.bandMaxForce)) {
  bandMaxForceCommands[Number(lbs)] = hexToBytes(hex);
}

/** Isokinetic target speed commands (mm/s) */
const isokineticTargetSpeedCommands: Record<number, Uint8Array> = {};
for (const [mmps, hex] of Object.entries(protocol.commands.isokineticTargetSpeed)) {
  isokineticTargetSpeedCommands[Number(mmps)] = hexToBytes(hex);
}

/** Isokinetic eccentric mode commands ('isokinetic' | 'constant') */
const isokineticEccModeCommands: Record<string, Uint8Array> = {};
for (const [mode, hex] of Object.entries(protocol.commands.isokineticEccMode)) {
  isokineticEccModeCommands[mode] = hexToBytes(hex);
}

/** Isokinetic eccentric speed limit commands (mm/s; 0 = auto) */
const isokineticEccSpeedLimitCommands: Record<number, Uint8Array> = {};
for (const [mmps, hex] of Object.entries(protocol.commands.isokineticEccSpeedLimit)) {
  isokineticEccSpeedLimitCommands[Number(mmps)] = hexToBytes(hex);
}

/** Isokinetic eccentric constant-mode weight commands (lbs) */
const isokineticEccConstWeightCommands: Record<number, Uint8Array> = {};
for (const [lbs, hex] of Object.entries(protocol.commands.isokineticEccConstWeight)) {
  isokineticEccConstWeightCommands[Number(lbs)] = hexToBytes(hex);
}

/** Isokinetic eccentric overload-mode weight commands (lbs) */
const isokineticEccOverloadWeightCommands: Record<number, Uint8Array> = {};
for (const [lbs, hex] of Object.entries(protocol.commands.isokineticEccOverloadWeight)) {
  isokineticEccOverloadWeightCommands[Number(lbs)] = hexToBytes(hex);
}

/**
 * Get damper level command.
 * @param level Damper level (0-9; UI displays N+1)
 * @returns Command bytes, or null if not available
 */
export function getDamperLevelCommand(level: number): Uint8Array | null {
  return damperLevelCommands[level] || null;
}

/** Get available damper levels. */
export function getAvailableDamperLevels(): number[] {
  return Object.keys(damperLevelCommands)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Get assist mode command.
 * @param mode 'off' or 'on'
 * @returns Command bytes, or null if not available
 */
export function getAssistModeCommand(mode: 'off' | 'on'): Uint8Array | null {
  return assistModeCommands[mode] || null;
}

/**
 * Get resistance band max force command.
 * @param lbs Max force in pounds
 * @returns Command bytes, or null if not available
 */
export function getBandMaxForceCommand(lbs: number): Uint8Array | null {
  return bandMaxForceCommands[lbs] || null;
}

/** Get available band max force values. */
export function getAvailableBandMaxForce(): number[] {
  return Object.keys(bandMaxForceCommands)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Get isokinetic target speed command.
 * @param mmPerSec Target speed in mm/s (0..2000, step 10). UI shows ÷1000 m/s.
 * @returns Command bytes, or null if not available
 */
export function getIsokineticTargetSpeedCommand(mmPerSec: number): Uint8Array | null {
  return isokineticTargetSpeedCommands[mmPerSec] || null;
}

/** Get available isokinetic target speeds (mm/s). */
export function getAvailableIsokineticTargetSpeeds(): number[] {
  return Object.keys(isokineticTargetSpeedCommands)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Get isokinetic eccentric mode command.
 * @param mode 'isokinetic' or 'constant'
 * @returns Command bytes, or null if not available
 */
export function getIsokineticEccModeCommand(mode: 'isokinetic' | 'constant'): Uint8Array | null {
  return isokineticEccModeCommands[mode] || null;
}

/**
 * Get isokinetic eccentric speed limit command.
 * @param mmPerSec Speed limit in mm/s; 0 = auto
 * @returns Command bytes, or null if not available
 */
export function getIsokineticEccSpeedLimitCommand(mmPerSec: number): Uint8Array | null {
  return isokineticEccSpeedLimitCommands[mmPerSec] || null;
}

/** Get available isokinetic eccentric speed limits (mm/s). */
export function getAvailableIsokineticEccSpeedLimits(): number[] {
  return Object.keys(isokineticEccSpeedLimitCommands)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Get isokinetic eccentric constant-mode weight command.
 * @param lbs Weight in pounds (0..200)
 * @returns Command bytes, or null if not available
 */
export function getIsokineticEccConstWeightCommand(lbs: number): Uint8Array | null {
  return isokineticEccConstWeightCommands[lbs] || null;
}

/** Get available isokinetic eccentric constant-mode weights. */
export function getAvailableIsokineticEccConstWeights(): number[] {
  return Object.keys(isokineticEccConstWeightCommands)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Get isokinetic eccentric overload-mode weight command.
 * @param lbs Weight in pounds (0..200)
 * @returns Command bytes, or null if not available
 */
export function getIsokineticEccOverloadWeightCommand(lbs: number): Uint8Array | null {
  return isokineticEccOverloadWeightCommands[lbs] || null;
}

/** Get available isokinetic eccentric overload-mode weights. */
export function getAvailableIsokineticEccOverloadWeights(): number[] {
  return Object.keys(isokineticEccOverloadWeightCommands)
    .map(Number)
    .sort((a, b) => a - b);
}
