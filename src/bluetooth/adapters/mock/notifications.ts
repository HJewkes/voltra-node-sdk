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
  NotificationConfigs,
  VendorMessages,
} from '../../../voltra/protocol/constants/message-types';
import { createFrame } from '../../../voltra/models/telemetry/frame';
import { encodeTelemetryFrame } from '../../../voltra/protocol/telemetry-decoder';
import { getModeCommand } from '../../../voltra/protocol/commands';
import { bytesEqual, hexToBytes } from '../../../shared/utils';
import type { VendorSubTypeConfig } from '../../../voltra/protocol/types';

export function buildIdleFrame(sequence: number): Uint8Array {
  const frame = createFrame(sequence, MovementPhase.IDLE, 0, 0, 0);
  return encodeTelemetryFrame(frame);
}

/**
 * Build a stub vendor sub-type frame containing the cmd marker and
 * identifier bytes at the documented offsets. Padded to the sub-type's
 * documented frameLength so consumers see realistic frame sizes; all
 * other bytes are zero.
 */
function buildVendorSubTypeStub(subType: VendorSubTypeConfig): Uint8Array {
  const minLength = VendorMessages.cmdByteOffset + 1 + subType.identifierBytes.length;
  const length = subType.frameLength ?? minLength;
  const data = new Uint8Array(length);
  data[VendorMessages.cmdByteOffset] = VendorMessages.cmdValue;
  for (let i = 0; i < subType.identifierBytes.length; i++) {
    data[VendorMessages.cmdByteOffset + 1 + i] = subType.identifierBytes[i];
  }
  return data;
}

export function buildRepBoundary(): Uint8Array {
  return buildVendorSubTypeStub(VendorMessages.subTypes.perRep);
}

export function buildSetBoundary(): Uint8Array {
  return buildVendorSubTypeStub(VendorMessages.subTypes.inProgress);
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
