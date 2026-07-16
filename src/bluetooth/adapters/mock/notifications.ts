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
  ParamIdHex,
  Uint16ParamIds,
  VendorMessages,
} from '../../../voltra/protocol/constants/message-types';
import { createFrame } from '../../../voltra/models/telemetry/frame';
import { encodeTelemetryFrame } from '../../../voltra/protocol/telemetry-decoder';
import { buildEnvelopedFrame } from '../../../voltra/protocol/_factories/frame-factories.generated';
import {
  getAvailableChains,
  getAvailableWeights,
  getChainsCommand,
  getModeCommand,
  getWeightCommand,
} from '../../../voltra/protocol/commands';
import { bytesEqual, bytesToHex, hexToBytes } from '../../../shared/utils';
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

/** A user-set device setting recovered from an outbound write command. */
export interface DetectedSetting {
  baseWeight?: number;
  chains?: number;
}

// cmd byte for the async-state cascade (settings-update) frame family.
const CMD_ASYNC_STATE = 0x10;
// Device→app routing bytes (frame offsets 4–5) for an inbound notification.
const DEVICE_TO_APP: readonly [number, number] = [0x10, 0xaa];

// Reverse index: outbound weight/chains command bytes -> the value they set.
// Built once from the protocol command tables so `detectSettingCommand` is a
// single hex lookup, mirroring how `detectModeCommand` matches mode writes.
const SETTING_COMMAND_INDEX: ReadonlyMap<string, DetectedSetting> = buildSettingCommandIndex();

function buildSettingCommandIndex(): Map<string, DetectedSetting> {
  const index = new Map<string, DetectedSetting>();
  for (const lbs of getAvailableWeights()) {
    const cmd = getWeightCommand(lbs);
    if (cmd) index.set(bytesToHex(cmd), { baseWeight: lbs });
  }
  for (const lbs of getAvailableChains()) {
    const cmd = getChainsCommand(lbs);
    if (cmd) index.set(bytesToHex(cmd), { chains: lbs });
  }
  return index;
}

/**
 * Reverse-lookup an outbound settings write (weight / chains) back to its
 * configured value. Returns null for any frame that isn't a recognized
 * weight/chains command.
 */
export function detectSettingCommand(data: Uint8Array): DetectedSetting | null {
  return SETTING_COMMAND_INDEX.get(bytesToHex(data)) ?? null;
}

/**
 * Build the cmd=0x10 settings-update cascade a real device echoes after a
 * weight/chains write (and surfaces post-bootstrap). It decodes back through
 * the SAME `onSettingsUpdate` path real hardware uses, so the mock stays
 * faithful instead of special-casing weight downstream. Param IDs and value
 * widths come from the protocol catalog — no raw bytes are hardcoded here.
 */
export function buildSettingsUpdate(setting: DetectedSetting): Uint8Array {
  const params: Array<[string, number]> = [];
  if (setting.baseWeight !== undefined) params.push([ParamIdHex.BASE_WEIGHT, setting.baseWeight]);
  if (setting.chains !== undefined) params.push([ParamIdHex.CHAINS, setting.chains]);

  const body: number[] = [params.length, 0x00];
  for (const [idHex, value] of params) {
    body.push(...hexToBytes(idHex), ...encodeParamValue(idHex, value));
  }
  return buildEnvelopedFrame(CMD_ASYNC_STATE, Uint8Array.from(body), {
    senderReceiver: DEVICE_TO_APP,
  });
}

function encodeParamValue(idHex: string, value: number): number[] {
  return Uint16ParamIds.has(idHex) ? [value & 0xff, (value >> 8) & 0xff] : [value & 0xff];
}
