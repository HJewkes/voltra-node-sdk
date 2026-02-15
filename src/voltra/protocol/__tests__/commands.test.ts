import { describe, it, expect } from 'vitest';
import {
  getWeightCommand,
  getChainsCommand,
  getEccentricCommand,
  getInverseChainsCommand,
  getModeCommand,
  getAvailableWeights,
  getAvailableChains,
  getAvailableEccentric,
  getAvailableInverseChains,
  getAvailableModes,
} from '../commands';
import { TrainingMode, VALID_TRAINING_MODES } from '../constants';

describe('commands', () => {
  // ===========================================================================
  // Weight Commands
  // ===========================================================================

  describe('getWeightCommand', () => {
    it('returns bytes for valid weight values', () => {
      const cmd = getWeightCommand(50);
      expect(cmd).toBeInstanceOf(Uint8Array);
      expect(cmd!.length).toBeGreaterThan(0);
    });

    it('returns null for invalid weight values', () => {
      expect(getWeightCommand(0)).toBeNull();
      expect(getWeightCommand(3)).toBeNull();
      expect(getWeightCommand(999)).toBeNull();
      expect(getWeightCommand(-10)).toBeNull();
    });

    it('returns bytes for boundary weight values', () => {
      expect(getWeightCommand(5)).toBeInstanceOf(Uint8Array);
      expect(getWeightCommand(200)).toBeInstanceOf(Uint8Array);
    });

    it('returns different bytes for different weights', () => {
      const cmd50 = getWeightCommand(50);
      const cmd100 = getWeightCommand(100);
      expect(cmd50).not.toEqual(cmd100);
    });
  });

  describe('getAvailableWeights', () => {
    it('returns a sorted array of numbers', () => {
      const weights = getAvailableWeights();
      expect(weights.length).toBeGreaterThan(0);
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i]).toBeGreaterThan(weights[i - 1]);
      }
    });

    it('includes boundary values 5 and 200', () => {
      const weights = getAvailableWeights();
      expect(weights).toContain(5);
      expect(weights).toContain(200);
    });

    it('all values produce valid commands', () => {
      for (const w of getAvailableWeights()) {
        expect(getWeightCommand(w)).toBeInstanceOf(Uint8Array);
      }
    });
  });

  // ===========================================================================
  // Chains Commands
  // ===========================================================================

  describe('getChainsCommand', () => {
    it('returns bytes for valid chains values', () => {
      const cmd = getChainsCommand(10);
      expect(cmd).toBeInstanceOf(Uint8Array);
    });

    it('returns null for invalid chains values', () => {
      expect(getChainsCommand(-1)).toBeNull();
      expect(getChainsCommand(999)).toBeNull();
    });

    it('returns bytes for 0 (off)', () => {
      expect(getChainsCommand(0)).toBeInstanceOf(Uint8Array);
    });
  });

  describe('getAvailableChains', () => {
    it('returns a sorted array', () => {
      const chains = getAvailableChains();
      expect(chains.length).toBeGreaterThan(0);
      for (let i = 1; i < chains.length; i++) {
        expect(chains[i]).toBeGreaterThan(chains[i - 1]);
      }
    });

    it('includes 0', () => {
      expect(getAvailableChains()).toContain(0);
    });
  });

  // ===========================================================================
  // Eccentric Commands
  // ===========================================================================

  describe('getEccentricCommand', () => {
    it('returns bytes for valid eccentric values', () => {
      expect(getEccentricCommand(0)).toBeInstanceOf(Uint8Array);
    });

    it('returns null for invalid eccentric values', () => {
      expect(getEccentricCommand(999)).toBeNull();
      expect(getEccentricCommand(-999)).toBeNull();
    });
  });

  describe('getAvailableEccentric', () => {
    it('returns a sorted array', () => {
      const ecc = getAvailableEccentric();
      expect(ecc.length).toBeGreaterThan(0);
      for (let i = 1; i < ecc.length; i++) {
        expect(ecc[i]).toBeGreaterThan(ecc[i - 1]);
      }
    });
  });

  // ===========================================================================
  // Inverse Chains Commands
  // ===========================================================================

  describe('getInverseChainsCommand', () => {
    it('returns bytes for valid inverse chains values', () => {
      expect(getInverseChainsCommand(0)).toBeInstanceOf(Uint8Array);
    });

    it('returns null for invalid values', () => {
      expect(getInverseChainsCommand(-1)).toBeNull();
      expect(getInverseChainsCommand(999)).toBeNull();
    });
  });

  describe('getAvailableInverseChains', () => {
    it('returns a sorted array', () => {
      const ic = getAvailableInverseChains();
      expect(ic.length).toBeGreaterThan(0);
      for (let i = 1; i < ic.length; i++) {
        expect(ic[i]).toBeGreaterThan(ic[i - 1]);
      }
    });

    it('includes 0', () => {
      expect(getAvailableInverseChains()).toContain(0);
    });
  });

  // ===========================================================================
  // Mode Commands
  // ===========================================================================

  describe('getModeCommand', () => {
    it('returns bytes for all valid training modes', () => {
      for (const mode of VALID_TRAINING_MODES) {
        const cmd = getModeCommand(mode);
        expect(cmd).toBeInstanceOf(Uint8Array);
        expect(cmd!.length).toBeGreaterThan(0);
      }
    });

    it('returns null for invalid mode', () => {
      expect(getModeCommand(999 as TrainingMode)).toBeNull();
    });

    it('returns different bytes for different modes', () => {
      const idle = getModeCommand(TrainingMode.Idle);
      const wt = getModeCommand(TrainingMode.WeightTraining);
      expect(idle).not.toEqual(wt);
    });
  });

  describe('getAvailableModes', () => {
    it('returns all valid training modes', () => {
      const modes = getAvailableModes();
      expect(modes).toEqual([...VALID_TRAINING_MODES]);
    });

    it('includes WeightTraining', () => {
      expect(getAvailableModes()).toContain(TrainingMode.WeightTraining);
    });
  });
});
