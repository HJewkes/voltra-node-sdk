import { describe, it, expect } from 'vitest';
import { VOLTRA_DEVICE_PREFIX, isVoltraDevice, filterVoltraDevices } from '../device-filter';
import type { DiscoveredDevice } from '../../../bluetooth/models/device';

function makeDevice(name: string | null, id = 'test-id'): DiscoveredDevice {
  return { id, name: name ?? undefined } as DiscoveredDevice;
}

describe('device-filter', () => {
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
  // isVoltraDevice
  // ===========================================================================

  describe('isVoltraDevice', () => {
    it('returns true for device with VTR- prefix', () => {
      expect(isVoltraDevice(makeDevice('VTR-123456'))).toBe(true);
    });

    it('returns true for device with just the prefix', () => {
      expect(isVoltraDevice(makeDevice(VOLTRA_DEVICE_PREFIX))).toBe(true);
    });

    it('returns false for non-Voltra device', () => {
      expect(isVoltraDevice(makeDevice('SomeOtherDevice'))).toBe(false);
    });

    it('returns false for null name', () => {
      expect(isVoltraDevice(makeDevice(null))).toBe(false);
    });

    it('returns false for device with prefix in middle of name', () => {
      expect(isVoltraDevice(makeDevice('MyVTR-Device'))).toBe(false);
    });
  });

  // ===========================================================================
  // filterVoltraDevices
  // ===========================================================================

  describe('filterVoltraDevices', () => {
    it('filters to only Voltra devices', () => {
      const devices = [
        makeDevice('VTR-001', '1'),
        makeDevice('OtherDevice', '2'),
        makeDevice('VTR-002', '3'),
        makeDevice(null, '4'),
      ];

      const filtered = filterVoltraDevices(devices);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe('1');
      expect(filtered[1].id).toBe('3');
    });

    it('returns empty array for empty input', () => {
      expect(filterVoltraDevices([])).toEqual([]);
    });

    it('returns empty array when no Voltra devices found', () => {
      const devices = [makeDevice('Device-A', '1'), makeDevice('Device-B', '2')];
      expect(filterVoltraDevices(devices)).toEqual([]);
    });

    it('returns all devices when all are Voltra', () => {
      const devices = [makeDevice('VTR-001', '1'), makeDevice('VTR-002', '2')];
      expect(filterVoltraDevices(devices)).toHaveLength(2);
    });
  });
});
