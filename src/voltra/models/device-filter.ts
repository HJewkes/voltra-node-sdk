/**
 * Voltra Device Filter
 *
 * Utility functions for filtering Voltra devices from BLE scan results.
 */

import { type DiscoveredDevice } from '../../bluetooth/models/device';
import { BLE } from '../protocol/constants';

/**
 * Voltra device name prefix.
 */
export const VOLTRA_DEVICE_PREFIX = BLE.DEVICE_NAME_PREFIX;

/**
 * Check if a device is a Voltra device.
 */
export function isVoltraDevice(device: DiscoveredDevice): boolean {
  return device.name?.startsWith(VOLTRA_DEVICE_PREFIX) ?? false;
}

/**
 * Filter Voltra devices from a list.
 */
export function filterVoltraDevices(devices: DiscoveredDevice[]): DiscoveredDevice[] {
  return devices.filter(isVoltraDevice);
}
