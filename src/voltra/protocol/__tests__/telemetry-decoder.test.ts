/**
 * Telemetry Decoder Tests
 *
 * Tests for BLE telemetry notification parsing:
 * - Message type identification
 * - Telemetry frame decoding
 * - Notification decoding dispatch
 * - Frame encoding (for replay)
 * - Byte parsing helpers
 * - Edge cases and error handling
 */

import { describe, it, expect } from 'vitest';
import {
  identifyMessageType,
  decodeTelemetryFrame,
  decodeNotification,
  encodeTelemetryFrame,
  type MessageType,
} from '../telemetry-decoder';
import {
  MessageTypes,
  TelemetryOffsets,
  MovementPhase,
  NotificationConfigs,
  ParamIdHex,
  TrainingMode,
} from '../constants';
import { hexToBytes } from '../../../shared/utils';
import type { TelemetryFrame } from '../../models/telemetry/frame';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a test telemetry notification buffer.
 * Sets up minimum valid 30-byte buffer with correct header.
 */
function createTelemetryBuffer(
  overrides: {
    sequence?: number;
    phase?: MovementPhase;
    position?: number;
    force?: number;
    velocity?: number;
  } = {}
): Uint8Array {
  const buffer = new Uint8Array(30);

  // Set telemetry stream header (first 4 bytes)
  buffer[0] = MessageTypes.TELEMETRY_STREAM[0];
  buffer[1] = MessageTypes.TELEMETRY_STREAM[1];
  buffer[2] = MessageTypes.TELEMETRY_STREAM[2];
  buffer[3] = MessageTypes.TELEMETRY_STREAM[3];

  // Sequence (little-endian uint16)
  const sequence = overrides.sequence ?? 1;
  buffer[TelemetryOffsets.SEQUENCE] = sequence & 0xff;
  buffer[TelemetryOffsets.SEQUENCE + 1] = (sequence >> 8) & 0xff;

  // Phase
  buffer[TelemetryOffsets.PHASE] = overrides.phase ?? MovementPhase.IDLE;

  // Position (little-endian uint16)
  const position = overrides.position ?? 0;
  buffer[TelemetryOffsets.POSITION] = position & 0xff;
  buffer[TelemetryOffsets.POSITION + 1] = (position >> 8) & 0xff;

  // Force (little-endian int16)
  let force = overrides.force ?? 0;
  if (force < 0) force += 0x10000;
  buffer[TelemetryOffsets.FORCE] = force & 0xff;
  buffer[TelemetryOffsets.FORCE + 1] = (force >> 8) & 0xff;

  // Velocity (little-endian uint16)
  const velocity = overrides.velocity ?? 0;
  buffer[TelemetryOffsets.VELOCITY] = velocity & 0xff;
  buffer[TelemetryOffsets.VELOCITY + 1] = (velocity >> 8) & 0xff;

  return buffer;
}

/**
 * Create a buffer with specific message type header.
 */
function createMessageBuffer(header: Uint8Array, minLength: number = 30): Uint8Array {
  const buffer = new Uint8Array(minLength);
  buffer.set(header);
  return buffer;
}

// =============================================================================
// Message Type Identification Tests
// =============================================================================

describe('identifyMessageType', () => {
  it('identifies telemetry stream messages', () => {
    const buffer = createMessageBuffer(MessageTypes.TELEMETRY_STREAM);

    const result = identifyMessageType(buffer);

    expect(result).toBe('telemetry_stream');
  });

  it('identifies rep summary messages', () => {
    const buffer = createMessageBuffer(MessageTypes.REP_SUMMARY);

    const result = identifyMessageType(buffer);

    expect(result).toBe('rep_summary');
  });

  it('identifies set summary messages', () => {
    const buffer = createMessageBuffer(MessageTypes.SET_SUMMARY);

    const result = identifyMessageType(buffer);

    expect(result).toBe('set_summary');
  });

  it('identifies status update messages', () => {
    const buffer = createMessageBuffer(MessageTypes.STATUS_UPDATE);

    const result = identifyMessageType(buffer);

    expect(result).toBe('status_update');
  });

  it('returns unknown for unrecognized message type', () => {
    const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00, ...new Array(26).fill(0)]);

    const result = identifyMessageType(buffer);

    expect(result).toBe('unknown');
  });

  it('returns unknown for buffer shorter than 4 bytes', () => {
    const buffer = new Uint8Array([0x55, 0x3a, 0x04]);

    const result = identifyMessageType(buffer);

    expect(result).toBe('unknown');
  });

  it('returns unknown for empty buffer', () => {
    const buffer = new Uint8Array(0);

    const result = identifyMessageType(buffer);

    expect(result).toBe('unknown');
  });

  it('correctly compares all 4 header bytes', () => {
    // Create buffer with almost-matching header (1 byte different)
    const almostTelemetry = new Uint8Array(30);
    almostTelemetry[0] = MessageTypes.TELEMETRY_STREAM[0];
    almostTelemetry[1] = MessageTypes.TELEMETRY_STREAM[1];
    almostTelemetry[2] = MessageTypes.TELEMETRY_STREAM[2];
    almostTelemetry[3] = MessageTypes.TELEMETRY_STREAM[3] ^ 0xff; // Flip last byte

    const result = identifyMessageType(almostTelemetry);

    expect(result).toBe('unknown');
  });
});

// =============================================================================
// Telemetry Frame Decoding Tests
// =============================================================================

describe('decodeTelemetryFrame', () => {
  it('decodes valid telemetry frame with all fields', () => {
    const buffer = createTelemetryBuffer({
      sequence: 1234,
      phase: MovementPhase.CONCENTRIC,
      position: 300,
      force: 85,
      velocity: 500,
    });

    const frame = decodeTelemetryFrame(buffer);

    expect(frame).not.toBeNull();
    expect(frame!.sequence).toBe(1234);
    expect(frame!.phase).toBe(MovementPhase.CONCENTRIC);
    expect(frame!.position).toBe(300);
    expect(frame!.force).toBe(85);
    expect(frame!.velocity).toBe(500);
    expect(frame!.timestamp).toBeGreaterThan(0);
  });

  it('decodes all movement phases correctly', () => {
    const phases = [
      MovementPhase.IDLE,
      MovementPhase.CONCENTRIC,
      MovementPhase.HOLD,
      MovementPhase.ECCENTRIC,
    ];

    for (const phase of phases) {
      const buffer = createTelemetryBuffer({ phase });
      const frame = decodeTelemetryFrame(buffer);

      expect(frame).not.toBeNull();
      expect(frame!.phase).toBe(phase);
    }
  });

  it('maps invalid phase to UNKNOWN', () => {
    const buffer = createTelemetryBuffer();
    buffer[TelemetryOffsets.PHASE] = 99; // Invalid phase

    const frame = decodeTelemetryFrame(buffer);

    expect(frame).not.toBeNull();
    expect(frame!.phase).toBe(MovementPhase.UNKNOWN);
  });

  it('handles negative force values (eccentric)', () => {
    const buffer = createTelemetryBuffer({ force: -50 });

    const frame = decodeTelemetryFrame(buffer);

    expect(frame).not.toBeNull();
    expect(frame!.force).toBe(-50);
  });

  it('handles maximum int16 force', () => {
    const buffer = createTelemetryBuffer({ force: 32767 });

    const frame = decodeTelemetryFrame(buffer);

    expect(frame!.force).toBe(32767);
  });

  it('handles minimum int16 force', () => {
    const buffer = createTelemetryBuffer({ force: -32768 });

    const frame = decodeTelemetryFrame(buffer);

    expect(frame!.force).toBe(-32768);
  });

  it('handles maximum uint16 sequence', () => {
    const buffer = createTelemetryBuffer({ sequence: 65535 });

    const frame = decodeTelemetryFrame(buffer);

    expect(frame!.sequence).toBe(65535);
  });

  it('handles maximum uint16 position', () => {
    const buffer = createTelemetryBuffer({ position: 65535 });

    const frame = decodeTelemetryFrame(buffer);

    expect(frame!.position).toBe(65535);
  });

  it('handles maximum uint16 velocity', () => {
    const buffer = createTelemetryBuffer({ velocity: 65535 });

    const frame = decodeTelemetryFrame(buffer);

    expect(frame!.velocity).toBe(65535);
  });

  it('handles zero values', () => {
    const buffer = createTelemetryBuffer({
      sequence: 0,
      phase: MovementPhase.IDLE,
      position: 0,
      force: 0,
      velocity: 0,
    });

    const frame = decodeTelemetryFrame(buffer);

    expect(frame).not.toBeNull();
    expect(frame!.sequence).toBe(0);
    expect(frame!.position).toBe(0);
    expect(frame!.force).toBe(0);
    expect(frame!.velocity).toBe(0);
  });

  it('returns null for buffer shorter than 30 bytes', () => {
    const buffer = new Uint8Array(29);

    const frame = decodeTelemetryFrame(buffer);

    expect(frame).toBeNull();
  });

  it('handles exactly 30 bytes', () => {
    const buffer = createTelemetryBuffer({ sequence: 42 });

    const frame = decodeTelemetryFrame(buffer);

    expect(frame).not.toBeNull();
    expect(frame!.sequence).toBe(42);
  });

  it('handles longer buffer (extra bytes ignored)', () => {
    const buffer = new Uint8Array(50);
    const telemetryBuffer = createTelemetryBuffer({ sequence: 100 });
    buffer.set(telemetryBuffer);

    const frame = decodeTelemetryFrame(buffer);

    expect(frame).not.toBeNull();
    expect(frame!.sequence).toBe(100);
  });
});

// =============================================================================
// Notification Decoding Tests
// =============================================================================

describe('decodeNotification', () => {
  it('decodes telemetry stream to frame result', () => {
    const buffer = createTelemetryBuffer({
      sequence: 500,
      phase: MovementPhase.CONCENTRIC,
      position: 200,
      force: 75,
      velocity: 450,
    });

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('frame');
    if (result?.type === 'frame') {
      expect(result.frame.sequence).toBe(500);
      expect(result.frame.phase).toBe(MovementPhase.CONCENTRIC);
    }
  });

  it('decodes rep summary to rep_boundary result', () => {
    const buffer = createMessageBuffer(MessageTypes.REP_SUMMARY);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('rep_boundary');
  });

  it('decodes set summary to set_boundary result', () => {
    const buffer = createMessageBuffer(MessageTypes.SET_SUMMARY);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('set_boundary');
  });

  it('decodes status update to device_status result', () => {
    // Create a buffer that meets the statusBattery length requirement (52 bytes)
    const buffer = createMessageBuffer(MessageTypes.STATUS_UPDATE, 52);
    // Set battery level
    buffer[12] = 85;

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('device_status');
    if (result?.type === 'device_status') {
      expect(result.battery).toBe(85);
    }
  });

  it('returns unknown for unrecognized message type', () => {
    const buffer = new Uint8Array([0xff, 0xff, 0xff, 0xff, ...new Array(26).fill(0)]);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('unknown');
  });

  it('returns null for malformed telemetry (too short)', () => {
    // Create telemetry header but buffer too short
    const buffer = new Uint8Array(20);
    buffer.set(MessageTypes.TELEMETRY_STREAM);

    const result = decodeNotification(buffer);

    expect(result).toBeNull();
  });

  it('returns unknown for very short buffer', () => {
    const buffer = new Uint8Array([0x55]);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('unknown');
  });
});

// =============================================================================
// Frame Encoding Tests (for replay)
// =============================================================================

describe('encodeTelemetryFrame', () => {
  it('creates valid 30-byte buffer', () => {
    const frame: TelemetryFrame = {
      sequence: 100,
      phase: MovementPhase.CONCENTRIC,
      position: 250,
      force: 80,
      velocity: 600,
      timestamp: Date.now(),
    };

    const encoded = encodeTelemetryFrame(frame);

    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBe(30);
  });

  it('encodes telemetry stream header correctly', () => {
    const frame: TelemetryFrame = {
      sequence: 0,
      phase: MovementPhase.IDLE,
      position: 0,
      force: 0,
      velocity: 0,
      timestamp: Date.now(),
    };

    const encoded = encodeTelemetryFrame(frame);

    // Check header matches expected telemetry stream format
    expect(encoded[0]).toBe(0x55);
    expect(encoded[1]).toBe(0x3a);
    expect(encoded[2]).toBe(0x04);
    expect(encoded[3]).toBe(0x70);
  });

  it('round-trips frame through encode/decode', () => {
    const original: TelemetryFrame = {
      sequence: 12345,
      phase: MovementPhase.ECCENTRIC,
      position: 450,
      force: 95,
      velocity: 320,
      timestamp: Date.now(),
    };

    const encoded = encodeTelemetryFrame(original);
    const decoded = decodeTelemetryFrame(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.sequence).toBe(original.sequence);
    expect(decoded!.phase).toBe(original.phase);
    expect(decoded!.position).toBe(original.position);
    expect(decoded!.force).toBe(original.force);
    expect(decoded!.velocity).toBe(original.velocity);
  });

  it('round-trips negative force correctly', () => {
    const original: TelemetryFrame = {
      sequence: 1,
      phase: MovementPhase.ECCENTRIC,
      position: 100,
      force: -75, // Negative eccentric force
      velocity: 200,
      timestamp: Date.now(),
    };

    const encoded = encodeTelemetryFrame(original);
    const decoded = decodeTelemetryFrame(encoded);

    expect(decoded!.force).toBe(-75);
  });

  it('round-trips all phases correctly', () => {
    const phases = [
      MovementPhase.IDLE,
      MovementPhase.CONCENTRIC,
      MovementPhase.HOLD,
      MovementPhase.ECCENTRIC,
    ];

    for (const phase of phases) {
      const original: TelemetryFrame = {
        sequence: 1,
        phase,
        position: 0,
        force: 0,
        velocity: 0,
        timestamp: Date.now(),
      };

      const encoded = encodeTelemetryFrame(original);
      const decoded = decodeTelemetryFrame(encoded);

      expect(decoded!.phase).toBe(phase);
    }
  });

  it('round-trips max uint16 values', () => {
    const original: TelemetryFrame = {
      sequence: 65535,
      phase: MovementPhase.IDLE,
      position: 65535,
      force: 32767,
      velocity: 65535,
      timestamp: Date.now(),
    };

    const encoded = encodeTelemetryFrame(original);
    const decoded = decodeTelemetryFrame(encoded);

    expect(decoded!.sequence).toBe(65535);
    expect(decoded!.position).toBe(65535);
    expect(decoded!.force).toBe(32767);
    expect(decoded!.velocity).toBe(65535);
  });

  it('round-trips min int16 force', () => {
    const original: TelemetryFrame = {
      sequence: 1,
      phase: MovementPhase.ECCENTRIC,
      position: 0,
      force: -32768,
      velocity: 0,
      timestamp: Date.now(),
    };

    const encoded = encodeTelemetryFrame(original);
    const decoded = decodeTelemetryFrame(encoded);

    expect(decoded!.force).toBe(-32768);
  });
});

// =============================================================================
// Practical Scenarios
// =============================================================================

describe('practical scenarios', () => {
  it('simulates rep cycle with phase transitions', () => {
    const phases = [
      { phase: MovementPhase.IDLE, position: 0, force: 0, velocity: 0 },
      { phase: MovementPhase.CONCENTRIC, position: 100, force: 80, velocity: 500 },
      { phase: MovementPhase.CONCENTRIC, position: 300, force: 85, velocity: 450 },
      { phase: MovementPhase.HOLD, position: 450, force: 60, velocity: 50 },
      { phase: MovementPhase.ECCENTRIC, position: 400, force: -40, velocity: 200 },
      { phase: MovementPhase.ECCENTRIC, position: 100, force: -35, velocity: 180 },
      { phase: MovementPhase.IDLE, position: 0, force: 0, velocity: 0 },
    ];

    let sequence = 0;
    for (const expected of phases) {
      const buffer = createTelemetryBuffer({
        sequence: sequence++,
        phase: expected.phase,
        position: expected.position,
        force: expected.force,
        velocity: expected.velocity,
      });

      const result = decodeNotification(buffer);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('frame');
      if (result?.type === 'frame') {
        expect(result.frame.phase).toBe(expected.phase);
        expect(result.frame.position).toBe(expected.position);
        expect(result.frame.force).toBe(expected.force);
      }
    }
  });

  it('handles interleaved message types', () => {
    const messages: Array<{ buffer: Uint8Array; expectedType: MessageType | null }> = [
      { buffer: createTelemetryBuffer({ sequence: 1 }), expectedType: 'telemetry_stream' },
      { buffer: createTelemetryBuffer({ sequence: 2 }), expectedType: 'telemetry_stream' },
      { buffer: createMessageBuffer(MessageTypes.REP_SUMMARY), expectedType: 'rep_summary' },
      { buffer: createTelemetryBuffer({ sequence: 3 }), expectedType: 'telemetry_stream' },
      { buffer: createMessageBuffer(MessageTypes.STATUS_UPDATE), expectedType: 'status_update' },
      { buffer: createTelemetryBuffer({ sequence: 4 }), expectedType: 'telemetry_stream' },
      { buffer: createMessageBuffer(MessageTypes.SET_SUMMARY), expectedType: 'set_summary' },
    ];

    for (const { buffer, expectedType } of messages) {
      const identified = identifyMessageType(buffer);
      expect(identified).toBe(expectedType);
    }
  });

  it('handles rapid sequence numbers', () => {
    // Simulate 11 Hz telemetry stream
    const frames: TelemetryFrame[] = [];

    for (let i = 0; i < 100; i++) {
      const buffer = createTelemetryBuffer({
        sequence: i,
        phase: i % 2 === 0 ? MovementPhase.CONCENTRIC : MovementPhase.ECCENTRIC,
        position: 100 + i * 3,
        force: 50 + (i % 20),
        velocity: 400 + (i % 50),
      });

      const result = decodeNotification(buffer);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('frame');
      if (result?.type === 'frame') {
        frames.push(result.frame);
      }
    }

    // Verify sequence continuity
    for (let i = 0; i < frames.length; i++) {
      expect(frames[i].sequence).toBe(i);
    }
  });
});

// =============================================================================
// Notification Type Decoding Tests (mode, settings, device status)
// =============================================================================

/**
 * Create a mode_confirmation notification buffer.
 * Header: 0x55 0x12, length: 18, valueOffset: 15
 */
function createModeConfirmationBuffer(modeValue: number): Uint8Array {
  const config = NotificationConfigs.modeConfirmation;
  const buffer = new Uint8Array(config.length);
  const headerBytes = hexToBytes(config.header);
  buffer[0] = headerBytes[0];
  buffer[1] = headerBytes[1];
  if (config.valueOffset !== undefined) {
    buffer[config.valueOffset] = modeValue;
  }
  return buffer;
}

/**
 * Create a settings_update notification buffer.
 * Header: 0x55 0x2e, length: 46, params at offsets from protocol config.
 */
function createSettingsUpdateBuffer(
  params: Array<{ paramIdHex: string; value: number }>
): Uint8Array {
  const config = NotificationConfigs.settingsUpdate;
  const buffer = new Uint8Array(config.length!);
  const headerBytes = hexToBytes(config.header);
  buffer[0] = headerBytes[0];
  buffer[1] = headerBytes[1];

  // Set param count
  buffer[config.paramCountOffset!] = params.length;

  // Write each param (2-byte LE paramId + 2-byte LE value)
  for (let i = 0; i < params.length; i++) {
    const offset = config.firstParamOffset! + i * config.paramSize!;
    const paramBytes = hexToBytes(params[i].paramIdHex);
    buffer[offset] = paramBytes[0];
    buffer[offset + 1] = paramBytes[1];
    buffer[offset + 2] = params[i].value & 0xff;
    buffer[offset + 3] = (params[i].value >> 8) & 0xff;
  }

  return buffer;
}

/**
 * Create a device_init notification buffer.
 * Header: 0x55 0x23, length: 35, batteryOffset: 11
 */
function createDeviceInitBuffer(battery: number): Uint8Array {
  const config = NotificationConfigs.deviceInit;
  const buffer = new Uint8Array(config.length!);
  const headerBytes = hexToBytes(config.header);
  buffer[0] = headerBytes[0];
  buffer[1] = headerBytes[1];
  if (config.batteryOffset !== undefined) {
    buffer[config.batteryOffset] = battery;
  }
  return buffer;
}

/**
 * Create a status_battery notification buffer.
 * Header: 0x55 0x34, length: 52, batteryOffset: 12
 */
function createStatusBatteryBuffer(battery: number): Uint8Array {
  const config = NotificationConfigs.statusBattery;
  const buffer = new Uint8Array(config.length!);
  const headerBytes = hexToBytes(config.header);
  buffer[0] = headerBytes[0];
  buffer[1] = headerBytes[1];
  if (config.batteryOffset !== undefined) {
    buffer[config.batteryOffset] = battery;
  }
  return buffer;
}

describe('decodeNotification – mode_confirmation', () => {
  it('returns mode_confirmation with valid TrainingMode for WeightTraining', () => {
    const buffer = createModeConfirmationBuffer(TrainingMode.WeightTraining);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('mode_confirmation');
    if (result?.type === 'mode_confirmation') {
      expect(result.mode).toBe(TrainingMode.WeightTraining);
    }
  });

  it('returns mode_confirmation with valid TrainingMode for Rowing', () => {
    const buffer = createModeConfirmationBuffer(TrainingMode.Rowing);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('mode_confirmation');
    if (result?.type === 'mode_confirmation') {
      expect(result.mode).toBe(TrainingMode.Rowing);
    }
  });

  it('falls back to TrainingMode.Idle for invalid mode value', () => {
    // Mode value 99 is not a valid TrainingMode
    const buffer = createModeConfirmationBuffer(99);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('mode_confirmation');
    if (result?.type === 'mode_confirmation') {
      expect(result.mode).toBe(TrainingMode.Idle);
    }
  });

  it('returns mode_confirmation with Idle for mode value 0', () => {
    const buffer = createModeConfirmationBuffer(TrainingMode.Idle);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('mode_confirmation');
    if (result?.type === 'mode_confirmation') {
      expect(result.mode).toBe(TrainingMode.Idle);
    }
  });
});

describe('decodeNotification – settings_update', () => {
  it('returns settings_update with parsed baseWeight', () => {
    const buffer = createSettingsUpdateBuffer([{ paramIdHex: ParamIdHex.BASE_WEIGHT, value: 75 }]);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('settings_update');
    if (result?.type === 'settings_update') {
      expect(result.settings.baseWeight).toBe(75);
    }
  });

  it('returns settings_update with multiple params', () => {
    const buffer = createSettingsUpdateBuffer([
      { paramIdHex: ParamIdHex.BASE_WEIGHT, value: 100 },
      { paramIdHex: ParamIdHex.CHAINS, value: 20 },
      { paramIdHex: ParamIdHex.ECCENTRIC, value: 50 },
      { paramIdHex: ParamIdHex.TRAINING_MODE, value: TrainingMode.WeightTraining },
      { paramIdHex: ParamIdHex.INVERSE_CHAINS, value: 15 },
    ]);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('settings_update');
    if (result?.type === 'settings_update') {
      expect(result.settings.baseWeight).toBe(100);
      expect(result.settings.chains).toBe(20);
      expect(result.settings.eccentric).toBe(50);
      expect(result.settings.trainingMode).toBe(TrainingMode.WeightTraining);
      expect(result.settings.inverseChains).toBe(15);
    }
  });

  it('validates trainingMode in settings_update (invalid mode omitted)', () => {
    const buffer = createSettingsUpdateBuffer([
      { paramIdHex: ParamIdHex.TRAINING_MODE, value: 255 }, // invalid mode
    ]);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('settings_update');
    if (result?.type === 'settings_update') {
      expect(result.settings.trainingMode).toBeUndefined();
    }
  });
});

describe('decodeNotification – device_status (deviceInit & statusBattery)', () => {
  it('returns device_status with battery from deviceInit notification', () => {
    const buffer = createDeviceInitBuffer(92);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('device_status');
    if (result?.type === 'device_status') {
      expect(result.battery).toBe(92);
    }
  });

  it('returns device_status with battery from statusBattery notification', () => {
    const buffer = createStatusBatteryBuffer(45);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('device_status');
    if (result?.type === 'device_status') {
      expect(result.battery).toBe(45);
    }
  });

  it('handles zero battery level', () => {
    const buffer = createDeviceInitBuffer(0);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('device_status');
    if (result?.type === 'device_status') {
      expect(result.battery).toBe(0);
    }
  });

  it('handles 100% battery level', () => {
    const buffer = createStatusBatteryBuffer(100);

    const result = decodeNotification(buffer);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('device_status');
    if (result?.type === 'device_status') {
      expect(result.battery).toBe(100);
    }
  });
});
