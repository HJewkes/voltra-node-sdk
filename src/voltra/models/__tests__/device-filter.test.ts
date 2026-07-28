import { describe, it, expect, afterEach } from 'vitest';
import {
  VOLTRA_DEVICE_PREFIX,
  DEVICE_NAME_PREFIX_ENV_VAR,
  resolveDeviceNamePrefix,
  isVoltraDevice,
  filterVoltraDevices,
} from '../device-filter';
import type { DiscoveredDevice } from '../../../bluetooth/models/device';

function makeDevice(name: string | null, id = 'test-id'): DiscoveredDevice {
  return { id, name: name ?? undefined } as DiscoveredDevice;
}

describe('device-filter', () => {
  afterEach(() => {
    delete process.env[DEVICE_NAME_PREFIX_ENV_VAR];
  });

  // ===========================================================================
  // VOLTRA_DEVICE_PREFIX
  // ===========================================================================

  describe('VOLTRA_DEVICE_PREFIX', () => {
    it('is a non-empty string', () => {
      expect(typeof VOLTRA_DEVICE_PREFIX).toBe('string');
      expect(VOLTRA_DEVICE_PREFIX.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // resolveDeviceNamePrefix
  // ===========================================================================

  describe('resolveDeviceNamePrefix', () => {
    it('resolves to undefined when nothing is configured', () => {
      expect(resolveDeviceNamePrefix()).toBeUndefined();
    });

    it('returns an explicit prefix verbatim', () => {
      expect(resolveDeviceNamePrefix('VTR-')).toBe('VTR-');
    });

    it('treats null as explicitly disabled', () => {
      expect(resolveDeviceNamePrefix(null)).toBeUndefined();
    });

    it('treats empty string as explicitly disabled', () => {
      expect(resolveDeviceNamePrefix('')).toBeUndefined();
    });

    it('falls back to the environment variable', () => {
      process.env[DEVICE_NAME_PREFIX_ENV_VAR] = 'Voltra';
      expect(resolveDeviceNamePrefix()).toBe('Voltra');
    });

    it('prefers an explicit prefix over the environment variable', () => {
      process.env[DEVICE_NAME_PREFIX_ENV_VAR] = 'Voltra';
      expect(resolveDeviceNamePrefix('VTR-')).toBe('VTR-');
    });

    it('lets an explicit null override the environment variable', () => {
      process.env[DEVICE_NAME_PREFIX_ENV_VAR] = 'Voltra';
      expect(resolveDeviceNamePrefix(null)).toBeUndefined();
    });
  });

  // ===========================================================================
  // isVoltraDevice
  // ===========================================================================

  describe('isVoltraDevice', () => {
    it('accepts any device when no prefix is configured', () => {
      expect(isVoltraDevice(makeDevice('SomeOtherDevice'))).toBe(true);
      expect(isVoltraDevice(makeDevice('Voltra 1'))).toBe(true);
      expect(isVoltraDevice(makeDevice(null))).toBe(true);
    });

    it('matches the prefix when one is supplied', () => {
      expect(isVoltraDevice(makeDevice('VTR-123456'), VOLTRA_DEVICE_PREFIX)).toBe(true);
      expect(isVoltraDevice(makeDevice(VOLTRA_DEVICE_PREFIX), VOLTRA_DEVICE_PREFIX)).toBe(true);
    });

    it('rejects a non-matching name when a prefix is supplied', () => {
      expect(isVoltraDevice(makeDevice('SomeOtherDevice'), VOLTRA_DEVICE_PREFIX)).toBe(false);
    });

    it('rejects a null name when a prefix is supplied', () => {
      expect(isVoltraDevice(makeDevice(null), VOLTRA_DEVICE_PREFIX)).toBe(false);
    });

    it('anchors the prefix to the start of the name', () => {
      expect(isVoltraDevice(makeDevice('MyVTR-Device'), VOLTRA_DEVICE_PREFIX)).toBe(false);
    });

    it('matches a renamed device against a custom prefix', () => {
      expect(isVoltraDevice(makeDevice('Voltra 1'), 'Voltra')).toBe(true);
    });

    it('does not filter a renamed device by default — the regression case', () => {
      // A device renamed via the vendor app no longer advertises "VTR-".
      // Before 0.12.0 the hardcoded prefix silently dropped it.
      expect(isVoltraDevice(makeDevice('Voltra 1'))).toBe(true);
    });
  });

  // ===========================================================================
  // filterVoltraDevices
  // ===========================================================================

  describe('filterVoltraDevices', () => {
    it('returns every device untouched when no prefix is configured', () => {
      const devices = [
        makeDevice('VTR-001', '1'),
        makeDevice('OtherDevice', '2'),
        makeDevice('Voltra 1', '3'),
        makeDevice(null, '4'),
      ];
      expect(filterVoltraDevices(devices)).toHaveLength(4);
    });

    it('filters to matching devices when a prefix is supplied', () => {
      const devices = [
        makeDevice('VTR-001', '1'),
        makeDevice('OtherDevice', '2'),
        makeDevice('VTR-002', '3'),
        makeDevice(null, '4'),
      ];

      const filtered = filterVoltraDevices(devices, VOLTRA_DEVICE_PREFIX);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe('1');
      expect(filtered[1].id).toBe('3');
    });

    it('ignores the environment variable — callers pass a resolved prefix', () => {
      process.env[DEVICE_NAME_PREFIX_ENV_VAR] = 'Voltra';
      const devices = [makeDevice('Voltra 1', '1'), makeDevice('VTR-002', '2')];

      // Re-resolving here would let the env var resurrect a prefix the
      // caller explicitly turned off. Resolution belongs to VoltraManager.
      expect(filterVoltraDevices(devices)).toHaveLength(2);
    });

    it('returns empty array for empty input', () => {
      expect(filterVoltraDevices([])).toEqual([]);
    });

    it('returns empty array when nothing matches a supplied prefix', () => {
      const devices = [makeDevice('Device-A', '1'), makeDevice('Device-B', '2')];
      expect(filterVoltraDevices(devices, VOLTRA_DEVICE_PREFIX)).toEqual([]);
    });

    it('returns all devices when all match the supplied prefix', () => {
      const devices = [makeDevice('VTR-001', '1'), makeDevice('VTR-002', '2')];
      expect(filterVoltraDevices(devices, VOLTRA_DEVICE_PREFIX)).toHaveLength(2);
    });
  });
});
