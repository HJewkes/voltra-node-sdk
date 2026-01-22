/**
 * Bluetooth Device Model
 *
 * Represents a discovered BLE device from scanning.
 */

/**
 * A discovered BLE device.
 */
export interface DiscoveredDevice {
  /** Device identifier (address on Android, UUID on iOS) */
  id: string;
  /** Device name */
  name: string | null;
  /** Signal strength in dBm */
  rssi: number | null;
}

/**
 * Get display name for a device.
 */
export function getDeviceDisplayName(device: DiscoveredDevice): string {
  return device.name ?? `Device ${device.id.slice(0, 8)}`;
}

/**
 * Sort devices by signal strength (strongest first).
 */
export function sortBySignalStrength(devices: DiscoveredDevice[]): DiscoveredDevice[] {
  return [...devices].sort((a, b) => {
    const rssiA = a.rssi ?? -100;
    const rssiB = b.rssi ?? -100;
    return rssiB - rssiA; // Higher (less negative) is better
  });
}
