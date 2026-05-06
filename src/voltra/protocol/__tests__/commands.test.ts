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
  getDamperLevelCommand,
  getAssistModeCommand,
  getBandMaxForceCommand,
  getIsokineticTargetSpeedCommand,
  getIsokineticEccModeCommand,
  getIsokineticEccSpeedLimitCommand,
  getIsokineticEccConstWeightCommand,
  getIsokineticEccOverloadWeightCommand,
  getAvailableDamperLevels,
  getAvailableBandMaxForce,
  getAvailableIsokineticTargetSpeeds,
  getAvailableIsokineticEccSpeedLimits,
  getAvailableIsokineticEccConstWeights,
  getAvailableIsokineticEccOverloadWeights,
} from '../commands';
import { TrainingMode, VALID_TRAINING_MODES } from '../constants';
import { hexToBytes } from '../../../shared/utils';
import protocolData from '../data/protocol-data.generated';
import type { ProtocolData } from '../types';

const protocol = protocolData as ProtocolData;

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

  // ===========================================================================
  // Damper Level (added in 0.6.0)
  // ===========================================================================

  describe('getDamperLevelCommand', () => {
    it('returns bytes for valid level', () => {
      const cmd = getDamperLevelCommand(5);
      expect(cmd).toBeInstanceOf(Uint8Array);
      expect(cmd!.length).toBeGreaterThan(0);
    });

    it('returns null for invalid level', () => {
      expect(getDamperLevelCommand(10)).toBeNull();
      expect(getDamperLevelCommand(99)).toBeNull();
      expect(getDamperLevelCommand(-1)).toBeNull();
    });

    it('returns bytes at boundary values', () => {
      expect(getDamperLevelCommand(0)).toBeInstanceOf(Uint8Array);
      expect(getDamperLevelCommand(9)).toBeInstanceOf(Uint8Array);
    });

    it('matches expected bytes from generated data for level 0', () => {
      const expected = hexToBytes(protocol.commands.damperLevel['0']);
      expect(getDamperLevelCommand(0)).toEqual(expected);
    });
  });

  describe('getAvailableDamperLevels', () => {
    it('returns sorted [0..9]', () => {
      expect(getAvailableDamperLevels()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  // ===========================================================================
  // Assist Mode (added in 0.6.0)
  // ===========================================================================

  describe('getAssistModeCommand', () => {
    it('returns bytes for off and on', () => {
      expect(getAssistModeCommand('off')).toBeInstanceOf(Uint8Array);
      expect(getAssistModeCommand('on')).toBeInstanceOf(Uint8Array);
    });

    it('returns different bytes for off vs on', () => {
      expect(getAssistModeCommand('off')).not.toEqual(getAssistModeCommand('on'));
    });
  });

  // ===========================================================================
  // Band Max Force (added in 0.6.0)
  // ===========================================================================

  describe('getBandMaxForceCommand', () => {
    it('returns bytes for mid-range valid value', () => {
      expect(getBandMaxForceCommand(40)).toBeInstanceOf(Uint8Array);
    });

    it('returns null for out-of-range values', () => {
      expect(getBandMaxForceCommand(14)).toBeNull();
      expect(getBandMaxForceCommand(71)).toBeNull();
      expect(getBandMaxForceCommand(0)).toBeNull();
      expect(getBandMaxForceCommand(-5)).toBeNull();
    });

    it('returns bytes at boundary values', () => {
      expect(getBandMaxForceCommand(15)).toBeInstanceOf(Uint8Array);
      expect(getBandMaxForceCommand(70)).toBeInstanceOf(Uint8Array);
    });

    it('matches expected bytes from generated data for 15 lbs', () => {
      const expected = hexToBytes(protocol.commands.bandMaxForce['15']);
      expect(getBandMaxForceCommand(15)).toEqual(expected);
    });
  });

  describe('getAvailableBandMaxForce', () => {
    it('returns a sorted ascending array', () => {
      const values = getAvailableBandMaxForce();
      expect(values.length).toBeGreaterThan(0);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
      expect(values[0]).toBe(15);
      expect(values[values.length - 1]).toBe(70);
    });
  });

  // ===========================================================================
  // Isokinetic Target Speed (added in 0.6.0)
  // ===========================================================================

  describe('getIsokineticTargetSpeedCommand', () => {
    it('returns bytes for mid-range valid value', () => {
      expect(getIsokineticTargetSpeedCommand(1000)).toBeInstanceOf(Uint8Array);
    });

    it('returns null for off-step or out-of-range values', () => {
      // step is 10 mm/s, so 5 should be missing
      expect(getIsokineticTargetSpeedCommand(5)).toBeNull();
      expect(getIsokineticTargetSpeedCommand(2010)).toBeNull();
      expect(getIsokineticTargetSpeedCommand(-10)).toBeNull();
    });

    it('returns bytes at boundary values', () => {
      expect(getIsokineticTargetSpeedCommand(0)).toBeInstanceOf(Uint8Array);
      expect(getIsokineticTargetSpeedCommand(2000)).toBeInstanceOf(Uint8Array);
    });

    it('matches expected bytes from generated data for 100 mm/s', () => {
      const expected = hexToBytes(protocol.commands.isokineticTargetSpeed['100']);
      expect(getIsokineticTargetSpeedCommand(100)).toEqual(expected);
    });
  });

  describe('getAvailableIsokineticTargetSpeeds', () => {
    it('returns sorted ascending array stepped by 10', () => {
      const values = getAvailableIsokineticTargetSpeeds();
      expect(values[0]).toBe(0);
      expect(values[values.length - 1]).toBe(2000);
      for (let i = 1; i < values.length; i++) {
        expect(values[i] - values[i - 1]).toBe(10);
      }
    });
  });

  // ===========================================================================
  // Isokinetic Eccentric Mode (added in 0.6.0)
  // ===========================================================================

  describe('getIsokineticEccModeCommand', () => {
    it('returns bytes for both modes', () => {
      expect(getIsokineticEccModeCommand('isokinetic')).toBeInstanceOf(Uint8Array);
      expect(getIsokineticEccModeCommand('constant')).toBeInstanceOf(Uint8Array);
    });

    it('returns different bytes for the two modes', () => {
      expect(getIsokineticEccModeCommand('isokinetic')).not.toEqual(
        getIsokineticEccModeCommand('constant')
      );
    });
  });

  // ===========================================================================
  // Isokinetic Eccentric Speed Limit (added in 0.6.0)
  // ===========================================================================

  describe('getIsokineticEccSpeedLimitCommand', () => {
    it('returns bytes for valid mid-range value', () => {
      expect(getIsokineticEccSpeedLimitCommand(500)).toBeInstanceOf(Uint8Array);
    });

    it('returns null for invalid values', () => {
      expect(getIsokineticEccSpeedLimitCommand(2010)).toBeNull();
      expect(getIsokineticEccSpeedLimitCommand(-1)).toBeNull();
      expect(getIsokineticEccSpeedLimitCommand(7)).toBeNull(); // off-step
    });

    it('returns bytes at boundary values (0 = auto, 2000 = max)', () => {
      expect(getIsokineticEccSpeedLimitCommand(0)).toBeInstanceOf(Uint8Array);
      expect(getIsokineticEccSpeedLimitCommand(2000)).toBeInstanceOf(Uint8Array);
    });
  });

  describe('getAvailableIsokineticEccSpeedLimits', () => {
    it('returns sorted ascending array', () => {
      const values = getAvailableIsokineticEccSpeedLimits();
      expect(values.length).toBeGreaterThan(0);
      expect(values[0]).toBe(0);
      expect(values[values.length - 1]).toBe(2000);
    });
  });

  // ===========================================================================
  // Isokinetic Eccentric Const Weight (added in 0.6.0)
  // ===========================================================================

  describe('getIsokineticEccConstWeightCommand', () => {
    it('returns bytes for valid mid-range value', () => {
      expect(getIsokineticEccConstWeightCommand(50)).toBeInstanceOf(Uint8Array);
    });

    it('returns null for out-of-range values', () => {
      expect(getIsokineticEccConstWeightCommand(201)).toBeNull();
      expect(getIsokineticEccConstWeightCommand(-1)).toBeNull();
    });

    it('returns bytes at boundary values', () => {
      expect(getIsokineticEccConstWeightCommand(0)).toBeInstanceOf(Uint8Array);
      expect(getIsokineticEccConstWeightCommand(200)).toBeInstanceOf(Uint8Array);
    });
  });

  describe('getAvailableIsokineticEccConstWeights', () => {
    it('returns sorted ascending array [0..200]', () => {
      const values = getAvailableIsokineticEccConstWeights();
      expect(values[0]).toBe(0);
      expect(values[values.length - 1]).toBe(200);
      expect(values.length).toBe(201);
    });
  });

  // ===========================================================================
  // Isokinetic Eccentric Overload Weight (added in 0.6.0)
  // ===========================================================================

  describe('getIsokineticEccOverloadWeightCommand', () => {
    it('returns bytes for valid mid-range value', () => {
      expect(getIsokineticEccOverloadWeightCommand(50)).toBeInstanceOf(Uint8Array);
    });

    it('returns null for out-of-range values', () => {
      expect(getIsokineticEccOverloadWeightCommand(201)).toBeNull();
      expect(getIsokineticEccOverloadWeightCommand(-1)).toBeNull();
    });

    it('returns bytes at boundary values', () => {
      expect(getIsokineticEccOverloadWeightCommand(0)).toBeInstanceOf(Uint8Array);
      expect(getIsokineticEccOverloadWeightCommand(200)).toBeInstanceOf(Uint8Array);
    });
  });

  describe('getAvailableIsokineticEccOverloadWeights', () => {
    it('returns sorted ascending array [0..200]', () => {
      const values = getAvailableIsokineticEccOverloadWeights();
      expect(values[0]).toBe(0);
      expect(values[values.length - 1]).toBe(200);
      expect(values.length).toBe(201);
    });
  });
});
