/**
 * Voltra Protocol Command Builders
 *
 * Builds commands for setting weight, chains, and eccentric resistance.
 */

import { hexToBytes } from '../../shared/utils';
import weightsData from './data/weights.json';
import chainsData from './data/chains.json';
import eccentricData from './data/eccentric.json';

// Type definitions for JSON data
interface WeightValue {
  seq: string;
  checksum: string;
  _full?: string;
}

interface WeightsData {
  format: { prefix: string; mode: string; register: string; padding: string };
  values: Record<string, WeightValue>;
}

interface ChainsValue {
  step1_seq: string;
  step1_checksum: string;
  step2_seq: string;
  step2_checksum: string;
}

interface ChainsData {
  format: {
    step1: { prefix: string; mode: string; register: string; padding: string };
    step2: { prefix: string; mode: string; register: string; padding: string };
  };
  values: Record<string, ChainsValue>;
}

interface EccentricData {
  format: {
    step1: { prefix: string; mode: string; register: string; padding: string };
    step2: { prefix: string; mode: string; register: string; padding: string };
  };
  step1: { sequences: Record<string, string>; checksums: Record<string, string> };
  step2: { sequences: Record<string, string>; checksums: Record<string, string> };
}

// Type the JSON imports
const weights = weightsData as WeightsData;
const chains = chainsData as ChainsData;
const eccentric = eccentricData as EccentricData;

// =============================================================================
// Weight Commands (863e register)
// =============================================================================

/**
 * Weight command builder for 5-200 lbs in 5 lb increments.
 */
export const WeightCommands = {
  MIN: 5,
  MAX: 200,
  INCREMENT: 5,

  /** Get available weight values */
  getAvailable(): number[] {
    return Object.keys(weights.values)
      .map(Number)
      .sort((a, b) => a - b);
  },

  /** Check if a weight value is valid */
  isValid(pounds: number): boolean {
    return pounds >= this.MIN && pounds <= this.MAX && pounds % this.INCREMENT === 0;
  },

  /**
   * Get the command to set a specific weight.
   * @param pounds Weight in pounds (5-200 in increments of 5)
   * @returns 21-byte command, or null if weight not available
   */
  get(pounds: number): Uint8Array | null {
    const key = String(pounds);
    const values = weights.values;
    const format = weights.format;

    if (!(key in values)) {
      return null;
    }

    const data = values[key];
    return this._build(pounds, data.seq, data.checksum, format);
  },

  _build(
    pounds: number,
    seq: string,
    checksum: string,
    format: { prefix: string; mode: string; register: string; padding: string }
  ): Uint8Array {
    const cmd = new Uint8Array(21);
    let offset = 0;

    // Prefix
    const prefix = hexToBytes(format.prefix);
    cmd.set(prefix, offset);
    offset += prefix.length;

    // Sequence
    const seqBytes = hexToBytes(seq);
    cmd.set(seqBytes, offset);
    offset += seqBytes.length;

    // Mode
    const mode = hexToBytes(format.mode);
    cmd.set(mode, offset);
    offset += mode.length;

    // Register
    const register = hexToBytes(format.register);
    cmd.set(register, offset);
    offset += register.length;

    // Value (little-endian uint16)
    cmd[offset] = pounds & 0xff;
    cmd[offset + 1] = (pounds >> 8) & 0xff;
    offset += 2;

    // Checksum
    const checksumBytes = hexToBytes(checksum);
    cmd.set(checksumBytes, offset);
    offset += checksumBytes.length;

    // Padding
    const padding = hexToBytes(format.padding);
    cmd.set(padding, offset);

    return cmd;
  },
};

// =============================================================================
// Chains Commands (873e register)
// =============================================================================

/**
 * Dual command result for chains and eccentric.
 */
export interface DualCommand {
  step1: Uint8Array;
  step2: Uint8Array;
}

/**
 * Chains (reverse resistance) command builder for 0-100 lbs.
 * Requires dual commands: send step1, wait 500ms, send step2.
 */
export const ChainsCommands = {
  MIN: 0,
  MAX: 100,

  /** Get available chains values */
  getAvailable(): number[] {
    return Object.keys(chains.values)
      .map(Number)
      .sort((a, b) => a - b);
  },

  /** Check if a chains value is valid */
  isValid(pounds: number): boolean {
    return pounds >= this.MIN && pounds <= this.MAX;
  },

  /**
   * Get dual commands to set chains weight.
   * @param pounds Chains weight (0-100)
   * @returns Tuple of (step1, step2) commands, or null if not available
   */
  get(pounds: number): DualCommand | null {
    const key = String(pounds);
    const values = chains.values;
    const format = chains.format;

    if (!(key in values)) {
      return null;
    }

    const data = values[key];

    return {
      step1: this._build(pounds, 1, data.step1_seq, data.step1_checksum, format),
      step2: this._build(pounds, 2, data.step2_seq, data.step2_checksum, format),
    };
  },

  _build(
    pounds: number,
    step: 1 | 2,
    seq: string,
    checksum: string,
    format: ChainsData['format']
  ): Uint8Array {
    const fmt = format[`step${step}`];
    const cmd = new Uint8Array(21);
    let offset = 0;

    // Prefix
    const prefix = hexToBytes(fmt.prefix);
    cmd.set(prefix, offset);
    offset += prefix.length;

    // Sequence
    const seqBytes = hexToBytes(seq);
    cmd.set(seqBytes, offset);
    offset += seqBytes.length;

    // Mode
    const mode = hexToBytes(fmt.mode);
    cmd.set(mode, offset);
    offset += mode.length;

    // Register
    const register = hexToBytes(fmt.register);
    cmd.set(register, offset);
    offset += register.length;

    // Value (little-endian uint16)
    cmd[offset] = pounds & 0xff;
    cmd[offset + 1] = (pounds >> 8) & 0xff;
    offset += 2;

    // Checksum
    const checksumBytes = hexToBytes(checksum);
    cmd.set(checksumBytes, offset);
    offset += checksumBytes.length;

    // Padding
    const padding = hexToBytes(fmt.padding);
    cmd.set(padding, offset);

    return cmd;
  },
};

// =============================================================================
// Eccentric Commands (883e register)
// =============================================================================

/**
 * Eccentric load adjustment command builder for -195 to +195.
 * Requires dual commands: send step1, wait 500ms, send step2.
 */
export const EccentricCommands = {
  MIN: -195,
  MAX: 195,

  /** Get available eccentric values */
  getAvailable(): number[] {
    return Object.keys(eccentric.step1.checksums)
      .map(Number)
      .sort((a, b) => a - b);
  },

  /** Check if an eccentric value is valid */
  isValid(value: number): boolean {
    return value >= this.MIN && value <= this.MAX;
  },

  /**
   * Get dual commands to set eccentric load.
   * @param value Eccentric adjustment (-195 to +195)
   * @returns Tuple of (step1, step2) commands, or null if not available
   */
  get(value: number): DualCommand | null {
    const key = String(value);

    if (!(key in eccentric.step1.checksums)) {
      return null;
    }

    return {
      step1: this._build(value, 1),
      step2: this._build(value, 2),
    };
  },

  _build(value: number, step: 1 | 2): Uint8Array {
    const stepKey = `step${step}` as 'step1' | 'step2';
    const fmt = eccentric.format[stepKey];
    const seq = eccentric[stepKey].sequences[String(value)];
    const checksum = eccentric[stepKey].checksums[String(value)];

    const cmd = new Uint8Array(21);
    let offset = 0;

    // Prefix
    const prefix = hexToBytes(fmt.prefix);
    cmd.set(prefix, offset);
    offset += prefix.length;

    // Sequence
    const seqBytes = hexToBytes(seq);
    cmd.set(seqBytes, offset);
    offset += seqBytes.length;

    // Mode
    const mode = hexToBytes(fmt.mode);
    cmd.set(mode, offset);
    offset += mode.length;

    // Register
    const register = hexToBytes(fmt.register);
    cmd.set(register, offset);
    offset += register.length;

    // Value (little-endian int16, signed)
    const signedValue = value < 0 ? 0x10000 + value : value;
    cmd[offset] = signedValue & 0xff;
    cmd[offset + 1] = (signedValue >> 8) & 0xff;
    offset += 2;

    // Checksum
    const checksumBytes = hexToBytes(checksum);
    cmd.set(checksumBytes, offset);
    offset += checksumBytes.length;

    // Padding
    const padding = hexToBytes(fmt.padding);
    cmd.set(padding, offset);

    return cmd;
  },
};
