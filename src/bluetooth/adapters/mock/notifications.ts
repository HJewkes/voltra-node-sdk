/**
 * Notification builders for mock BLE telemetry simulation.
 *
 * Pure functions that create encoded notification payloads (rep boundary,
 * set boundary, mode confirmation, idle frame, mode command detection).
 */

import {
  MovementPhase,
  TrainingMode,
  VALID_TRAINING_MODES,
} from '../../../voltra/protocol/constants/enums';
import {
  MessageTypes,
  NotificationConfigs,
} from '../../../voltra/protocol/constants/message-types';
import { createFrame } from '../../../voltra/models/telemetry/frame';
import { encodeTelemetryFrame } from '../../../voltra/protocol/telemetry-decoder';
import { getModeCommand } from '../../../voltra/protocol/commands';
import { bytesEqual, hexToBytes } from '../../../shared/utils';

export function buildIdleFrame(sequence: number): Uint8Array {
  const frame = createFrame(sequence, MovementPhase.IDLE, 0, 0, 0);
  return encodeTelemetryFrame(frame);
}

export function buildRepBoundary(): Uint8Array {
  const data = new Uint8Array(4);
  data.set(MessageTypes.REP_SUMMARY);
  return data;
}

export function buildSetBoundary(): Uint8Array {
  const data = new Uint8Array(4);
  data.set(MessageTypes.SET_SUMMARY);
  return data;
}

export function buildModeConfirmation(mode: TrainingMode): Uint8Array {
  const config = NotificationConfigs.modeConfirmation;
  const length = config.length ?? 4;
  const data = new Uint8Array(length);
  const headerBytes = hexToBytes(config.header);
  data[0] = headerBytes[0];
  data[1] = headerBytes[1];
  if (config.valueOffset !== undefined) {
    data[config.valueOffset] = mode;
  }
  return data;
}

export function detectModeCommand(data: Uint8Array): TrainingMode | null {
  for (const mode of VALID_TRAINING_MODES) {
    const cmd = getModeCommand(mode);
    if (cmd && bytesEqual(data, cmd)) {
      return mode;
    }
  }
  return null;
}
