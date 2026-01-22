/**
 * Telemetry Decoder
 *
 * Low-level protocol decoder for Voltra BLE telemetry notifications.
 * Only handles parsing bytes into typed data - no business logic.
 */

import { MessageTypes, TelemetryOffsets, MovementPhase } from './constants';
import { createFrame, type TelemetryFrame } from '../models/telemetry/frame';
import { bytesEqual } from '../../shared/utils';

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
  | 'unknown';

/**
 * Identify the message type from raw bytes.
 */
export function identifyMessageType(data: Uint8Array): MessageType {
  if (data.length < 4) return 'unknown';

  const msgType = data.slice(0, 4);

  if (bytesEqual(msgType, MessageTypes.TELEMETRY_STREAM)) {
    return 'telemetry_stream';
  } else if (bytesEqual(msgType, MessageTypes.REP_SUMMARY)) {
    return 'rep_summary';
  } else if (bytesEqual(msgType, MessageTypes.SET_SUMMARY)) {
    return 'set_summary';
  } else if (bytesEqual(msgType, MessageTypes.STATUS_UPDATE)) {
    return 'status_update';
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
  | { type: 'status'; data: Uint8Array }
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

    case 'status_update':
      return { type: 'status', data };

    default:
      return null;
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
  data[0] = 0x55;
  data[1] = 0x3a;
  data[2] = 0x04;
  data[3] = 0x70;

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
