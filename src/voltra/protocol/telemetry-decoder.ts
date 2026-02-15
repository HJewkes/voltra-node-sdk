/**
 * Telemetry Decoder
 *
 * Low-level protocol decoder for Voltra BLE telemetry notifications.
 * Only handles parsing bytes into typed data - no business logic.
 * Uses offset-based lookups from protocol.json - no hardcoded byte positions.
 */

import {
  MessageTypes,
  TelemetryOffsets,
  MovementPhase,
  NotificationConfigs,
  ParamIdHex,
  Uint16ParamIds,
  TrainingMode,
  VALID_TRAINING_MODES,
} from './constants';
import { createFrame, type TelemetryFrame } from '../models/telemetry/frame';
import { bytesEqual, bytesToHex } from '../../shared/utils';
import type { DeviceSettings } from './types';

// =============================================================================
// Byte Parsing Helpers
// =============================================================================

/**
 * Read a little-endian uint16 from a Uint8Array.
 */
function readUint16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

/**
 * Read a little-endian int16 from a Uint8Array.
 */
function readInt16LE(data: Uint8Array, offset: number): number {
  const value = readUint16LE(data, offset);
  return value > 0x7fff ? value - 0x10000 : value;
}

/**
 * Write a little-endian uint16 to a Uint8Array.
 */
function writeUint16LE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >> 8) & 0xff;
}

/**
 * Write a little-endian int16 to a Uint8Array.
 */
function writeInt16LE(data: Uint8Array, offset: number, value: number): void {
  if (value < 0) {
    value = value + 0x10000;
  }
  writeUint16LE(data, offset, value);
}

// =============================================================================
// Message Types
// =============================================================================

/**
 * Types of messages that can be decoded.
 */
export type MessageType =
  | 'telemetry_stream'
  | 'rep_summary'
  | 'set_summary'
  | 'status_update'
  | 'mode_confirmation'
  | 'multi_param'
  | 'settings_update'
  | 'device_init'
  | 'unknown';

/**
 * Identify the message type from raw bytes.
 * Uses header matching from protocol.json configurations.
 */
export function identifyMessageType(data: Uint8Array): MessageType {
  if (data.length < 4) return 'unknown';

  const msgType = data.slice(0, 4);

  // Check 4-byte message types first (telemetry stream types)
  if (bytesEqual(msgType, MessageTypes.TELEMETRY_STREAM)) {
    return 'telemetry_stream';
  } else if (bytesEqual(msgType, MessageTypes.REP_SUMMARY)) {
    return 'rep_summary';
  } else if (bytesEqual(msgType, MessageTypes.SET_SUMMARY)) {
    return 'set_summary';
  } else if (bytesEqual(msgType, MessageTypes.STATUS_UPDATE)) {
    return 'status_update';
  }

  // Check 2-byte headers for other notification types
  const header2 = bytesToHex(data.slice(0, 2));

  if (header2 === NotificationConfigs.modeConfirmation.header) {
    return 'mode_confirmation';
  } else if (header2 === NotificationConfigs.multiParam.header) {
    return 'multi_param';
  } else if (header2 === NotificationConfigs.settingsUpdate.header) {
    return 'settings_update';
  } else if (header2 === NotificationConfigs.deviceInit.header) {
    return 'device_init';
  } else if (header2 === NotificationConfigs.statusBattery.header) {
    return 'status_update'; // Also a status type
  }

  return 'unknown';
}

// =============================================================================
// Decode Results
// =============================================================================

/**
 * Result of decoding a telemetry notification.
 */
export type DecodeResult =
  | { type: 'frame'; frame: TelemetryFrame }
  | { type: 'rep_boundary' } // Device signals rep completion
  | { type: 'set_boundary' } // Device signals set completion
  | { type: 'mode_confirmation'; mode: TrainingMode } // Mode change confirmed
  | { type: 'settings_update'; settings: DeviceSettings } // Device settings
  | { type: 'device_status'; battery: number } // Battery/status update
  | { type: 'unknown'; data: Uint8Array } // Unknown notification with raw data
  | null;

// =============================================================================
// Decoder
// =============================================================================

/**
 * Decode a telemetry stream message into a TelemetryFrame.
 */
export function decodeTelemetryFrame(data: Uint8Array): TelemetryFrame | null {
  if (data.length < 30) {
    return null;
  }

  // Sequence number
  const sequence = readUint16LE(data, TelemetryOffsets.SEQUENCE);

  // Phase
  const phaseByte = data[TelemetryOffsets.PHASE];
  let phase: MovementPhase;
  if (phaseByte >= 0 && phaseByte <= 3) {
    phase = phaseByte as MovementPhase;
  } else {
    phase = MovementPhase.UNKNOWN;
  }

  // Sensor data
  const position = readUint16LE(data, TelemetryOffsets.POSITION);
  const force = readInt16LE(data, TelemetryOffsets.FORCE);
  const velocity = readUint16LE(data, TelemetryOffsets.VELOCITY);

  return createFrame(sequence, phase, position, force, velocity);
}

/**
 * Decode a mode confirmation notification.
 * Returns the training mode value.
 */
function decodeModeConfirmation(data: Uint8Array): DecodeResult {
  const config = NotificationConfigs.modeConfirmation;
  if (config.length && data.length < config.length) return null;
  if (config.valueOffset === undefined) return null;

  const rawMode = data[config.valueOffset];
  const mode = VALID_TRAINING_MODES.includes(rawMode as TrainingMode)
    ? (rawMode as TrainingMode)
    : TrainingMode.Idle;
  return { type: 'mode_confirmation', mode };
}

/**
 * Decode a settings update or multi-param notification.
 * Handles mixed-size value fields: param IDs in Uint16ParamIds get 2-byte
 * (uint16 LE) values; all others get 1-byte (uint8) values.
 */
function decodeSettingsUpdate(data: Uint8Array): DecodeResult {
  const config = NotificationConfigs.settingsUpdate;
  if (config.paramCountOffset === undefined || config.firstParamOffset === undefined) {
    return null;
  }

  const settings: DeviceSettings = {};
  const paramCount = data[config.paramCountOffset];
  let offset = config.firstParamOffset;

  for (let i = 0; i < paramCount && i < 9; i++) {
    if (offset + 2 > data.length) break;

    const paramIdHex = bytesToHex(data.slice(offset, offset + 2));
    offset += 2;

    let value: number;
    if (Uint16ParamIds.has(paramIdHex)) {
      if (offset + 2 > data.length) break;
      value = readUint16LE(data, offset);
      offset += 2;
    } else {
      if (offset + 1 > data.length) break;
      value = data[offset];
      offset += 1;
    }

    if (paramIdHex === ParamIdHex.BASE_WEIGHT) {
      settings.baseWeight = value;
    } else if (paramIdHex === ParamIdHex.CHAINS) {
      settings.chains = value;
    } else if (paramIdHex === ParamIdHex.ECCENTRIC) {
      settings.eccentric = value;
    } else if (paramIdHex === ParamIdHex.TRAINING_MODE) {
      settings.trainingMode = VALID_TRAINING_MODES.includes(value as TrainingMode)
        ? (value as TrainingMode)
        : undefined;
    } else if (paramIdHex === ParamIdHex.INVERSE_CHAINS) {
      settings.inverseChains = value;
    }
  }

  return { type: 'settings_update', settings };
}

/**
 * Decode a device status notification.
 * Extracts battery level.
 */
function decodeDeviceStatus(data: Uint8Array): DecodeResult {
  // Try device init format first
  const initConfig = NotificationConfigs.deviceInit;
  if (
    initConfig.length &&
    data.length >= initConfig.length &&
    initConfig.batteryOffset !== undefined
  ) {
    const header = bytesToHex(data.slice(0, 2));
    if (header === initConfig.header) {
      const battery = data[initConfig.batteryOffset];
      return { type: 'device_status', battery };
    }
  }

  // Try status/battery format
  const statusConfig = NotificationConfigs.statusBattery;
  if (
    statusConfig.length &&
    data.length >= statusConfig.length &&
    statusConfig.batteryOffset !== undefined
  ) {
    const header = bytesToHex(data.slice(0, 2));
    if (header === statusConfig.header) {
      const battery = data[statusConfig.batteryOffset];
      return { type: 'device_status', battery };
    }
  }

  // Fallback: return unknown with raw data
  return { type: 'unknown', data };
}

/**
 * Decode a BLE notification.
 * Returns structured data based on message type.
 */
export function decodeNotification(data: Uint8Array): DecodeResult {
  const msgType = identifyMessageType(data);

  switch (msgType) {
    case 'telemetry_stream': {
      const frame = decodeTelemetryFrame(data);
      return frame ? { type: 'frame', frame } : null;
    }

    case 'rep_summary':
      // Device is signaling a rep boundary (end of concentric or eccentric)
      return { type: 'rep_boundary' };

    case 'set_summary':
      // Device is signaling set completion
      return { type: 'set_boundary' };

    case 'mode_confirmation':
      return decodeModeConfirmation(data);

    case 'settings_update':
    case 'multi_param':
      return decodeSettingsUpdate(data);

    case 'device_init':
    case 'status_update':
      return decodeDeviceStatus(data);

    default:
      return { type: 'unknown', data };
  }
}

// =============================================================================
// Encoder (for replay)
// =============================================================================

/**
 * Encode a TelemetryFrame into a BLE notification payload.
 * Creates a minimal 30-byte message that can be decoded by decodeTelemetryFrame.
 * Used for replay functionality.
 */
export function encodeTelemetryFrame(frame: TelemetryFrame): Uint8Array {
  const data = new Uint8Array(30);

  // Message type header (telemetry stream)
  const header = MessageTypes.TELEMETRY_STREAM;
  data[0] = header[0];
  data[1] = header[1];
  data[2] = header[2];
  data[3] = header[3];

  // Sequence (bytes 6-7)
  writeUint16LE(data, TelemetryOffsets.SEQUENCE, frame.sequence);

  // Phase (byte 13)
  data[TelemetryOffsets.PHASE] = frame.phase;

  // Position (bytes 24-25)
  writeUint16LE(data, TelemetryOffsets.POSITION, frame.position);

  // Force (bytes 26-27, signed)
  writeInt16LE(data, TelemetryOffsets.FORCE, frame.force);

  // Velocity (bytes 28-29)
  writeUint16LE(data, TelemetryOffsets.VELOCITY, frame.velocity);

  return data;
}
