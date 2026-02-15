/**
 * BLE Configuration
 *
 * Service UUIDs, characteristic UUIDs, and device naming for Voltra devices.
 */

import protocolData from '../data/protocol-data.generated';
import type { ProtocolData } from '../types';

const protocol = protocolData as ProtocolData;

export const BLE = {
  /** Main service UUID for Voltra devices */
  SERVICE_UUID: protocol.ble.serviceUuid,
  /** Characteristic for receiving notifications */
  NOTIFY_CHAR_UUID: protocol.ble.notifyCharUuid,
  /** Characteristic for writing commands */
  WRITE_CHAR_UUID: protocol.ble.writeCharUuid,
  /** Device name prefix for scanning (e.g., "VTR-") */
  DEVICE_NAME_PREFIX: protocol.ble.deviceNamePrefix,
} as const;
