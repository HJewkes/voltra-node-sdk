/**
 * Device-state helpers (VW-402).
 *
 * Two pieces the SDK needs so it can report what the device said rather than
 * what a GATT write ack said: a read frame that asks the device for its core
 * control values, and a classifier that turns the engagement register's
 * reported value into a motor state.
 *
 * Both are driven entirely by the generated protocol data — no register,
 * command or value is written down here.
 */

import { buildEnvelopedFrame } from './_factories';
import protocolData from './data/protocol-data.generated';
import type { ParameterCatalogEntry, ProtocolData } from './types';
import { hexToBytes } from '../../shared/utils';

const protocol = protocolData as ProtocolData;
const deviceState = protocol.commands.deviceState;

/**
 * What the device reported about the cable motor.
 *
 * A report whose value the protocol data does not classify yields `null` —
 * the SDK treats that as "still unknown" rather than guessing a side.
 */
export type MotorReport = 'engaged' | 'released';

function catalogEntry(key: string): ParameterCatalogEntry {
  const entry = protocol.telemetry.parameterCatalog?.[key];
  if (!entry) {
    throw new Error(`device-state: protocol data has no parameter catalog entry for '${key}'`);
  }
  return entry;
}

/** Registers the core-state read asks for, in the order it lists them. */
const CORE_STATE_PARAM_IDS = [
  deviceState.readFields.weight,
  deviceState.readFields.motorState,
  deviceState.readFields.trainingMode,
].map((key) => catalogEntry(key).paramId);

/** `parameterCatalog` key of the register that reports motor engagement. */
export const MOTOR_STATE_FIELD = deviceState.motorState.field;

/** `parameterCatalog` keys the core-state read asks for, in wire order. */
export const CORE_STATE_FIELDS = [
  deviceState.readFields.weight,
  deviceState.readFields.motorState,
  deviceState.readFields.trainingMode,
] as const;

/** Report values that mean the motor is holding load, and that it released. */
export const MOTOR_REPORT_VALUES: Record<MotorReport, number> = {
  engaged: deviceState.motorState.engaged[0],
  released: deviceState.motorState.released[0],
};

/**
 * Build the read frame that asks the device to report weight, motor state
 * and training mode.
 *
 * Omitting `sequence` uses the frame factories' default; callers that need a
 * fresh sequence per write can supply one.
 */
export function buildCoreStateReadFrame(sequence?: number): Uint8Array {
  const payload = new Uint8Array(2 + CORE_STATE_PARAM_IDS.length * 2);
  payload[0] = CORE_STATE_PARAM_IDS.length & 0xff;
  payload[1] = (CORE_STATE_PARAM_IDS.length >> 8) & 0xff;
  for (let i = 0; i < CORE_STATE_PARAM_IDS.length; i++) {
    payload[2 + i * 2] = CORE_STATE_PARAM_IDS[i] & 0xff;
    payload[2 + i * 2 + 1] = (CORE_STATE_PARAM_IDS[i] >> 8) & 0xff;
  }
  return buildEnvelopedFrame(hexToBytes(deviceState.readCmd)[0], payload, { sequence });
}

/**
 * Classify a reported engagement value.
 *
 * The high byte is a substate overlay, so the primary value is masked out
 * before it is compared. Returns `null` for any value the protocol data does
 * not list on either side.
 */
export function classifyMotorReport(value: number): MotorReport | null {
  const primary = value & deviceState.motorState.primaryMask;
  if (deviceState.motorState.engaged.includes(primary)) return 'engaged';
  if (deviceState.motorState.released.includes(primary)) return 'released';
  return null;
}

/**
 * True when the frame is the core-state read {@link buildCoreStateReadFrame}
 * produces. The sequence field and checksums are ignored, so a read built with
 * any sequence matches.
 */
export function isCoreStateRead(data: Uint8Array): boolean {
  const reference = buildCoreStateReadFrame();
  if (data.length !== reference.length) return false;
  const from = 10;
  const to = reference.length - 2;
  for (let i = from; i < to; i++) {
    if (data[i] !== reference[i]) return false;
  }
  return true;
}
