/**
 * Voltra Device Filter
 *
 * Utility functions for filtering Voltra devices from BLE scan results.
 *
 * Name-prefix filtering is OFF by default as of 0.12.0. Device identity
 * comes from the BLE service UUID, which every scan path now filters on;
 * the advertised name is cosmetic and user-renameable, so matching on it
 * silently hid legitimately-renamed devices.
 */

import { type DiscoveredDevice } from '../../bluetooth/models/device';
import { BLE } from '../protocol/constants';

/**
 * Factory-default Voltra device name prefix.
 *
 * Retained for consumers that want to opt back in to name filtering via
 * `new VoltraManager({ deviceNamePrefix: VOLTRA_DEVICE_PREFIX })`. It is
 * no longer applied automatically.
 */
export const VOLTRA_DEVICE_PREFIX = BLE.DEVICE_NAME_PREFIX;

/**
 * Environment variable that overrides the device name prefix in Node.
 * Set to a prefix string to filter; leave unset for no name filtering.
 */
export const DEVICE_NAME_PREFIX_ENV_VAR = 'VOLTRA_DEVICE_NAME_PREFIX';

/**
 * Resolve the effective device name prefix.
 *
 * `undefined` means "no explicit choice" and falls through to the env
 * var, then to no filtering. `null` and `''` both mean "explicitly off"
 * and short-circuit the env var.
 *
 * @param explicit Prefix supplied via manager or scan options
 * @returns The prefix to match on, or `undefined` for no name filtering
 */
export function resolveDeviceNamePrefix(explicit?: string | null): string | undefined {
  if (explicit !== undefined) {
    return explicit === null || explicit === '' ? undefined : explicit;
  }

  // `process` is absent in browsers and some React Native runtimes.
  const fromEnv =
    typeof process !== 'undefined' ? process.env?.[DEVICE_NAME_PREFIX_ENV_VAR] : undefined;

  return fromEnv ? fromEnv : undefined;
}

/**
 * Check if a device matches the given name prefix.
 *
 * Takes an ALREADY-RESOLVED prefix — it does not consult the
 * environment, so passing the output of `resolveDeviceNamePrefix` is
 * safe and an explicit "off" cannot be resurrected by the env var.
 * With no prefix every device passes; the service-UUID filter applied
 * during the scan itself is what establishes identity.
 *
 * @param device Device to test
 * @param prefix Resolved name prefix, or omit for no name filtering
 */
export function isVoltraDevice(device: DiscoveredDevice, prefix?: string | null): boolean {
  if (!prefix) return true;
  return device.name?.startsWith(prefix) ?? false;
}

/**
 * Filter Voltra devices from a list.
 *
 * Takes an ALREADY-RESOLVED prefix — see `isVoltraDevice`.
 *
 * @param devices Devices to filter
 * @param prefix Resolved name prefix, or omit for no name filtering
 */
export function filterVoltraDevices(
  devices: DiscoveredDevice[],
  prefix?: string | null
): DiscoveredDevice[] {
  if (!prefix) return devices;
  return devices.filter((device) => device.name?.startsWith(prefix) ?? false);
}
