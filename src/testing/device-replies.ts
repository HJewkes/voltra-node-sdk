/**
 * Device-side reply builders (VW-403).
 *
 * `connect()` resolves only once the device reports that it accepted the
 * connection, and control setters refuse to write until the device has
 * reported this connection's control values. Anything standing in for a
 * device therefore has to answer two writes: the handshake finish, and the
 * core-state read. These helpers are those answers.
 *
 * Everything here is driven by the generated protocol data and the decoders'
 * own encoders — no frame bytes are written down.
 */

import protocolData from '../voltra/protocol/data/protocol-data.generated';
import type { ProtocolData } from '../voltra/protocol/types';
import { TrainingMode } from '../voltra/protocol/constants';
import {
  CORE_STATE_FIELDS,
  MOTOR_REPORT_VALUES,
  isCoreStateRead,
} from '../voltra/protocol/device-state';
import { encodeBulkParamResponse } from '../voltra/protocol/telemetry-decoder';
import { hexToBytes } from '../shared/utils';

const protocol = protocolData as ProtocolData;
const HANDSHAKE_FINISH = hexToBytes(protocol.commands.init[protocol.commands.init.length - 1]);

function acceptanceConfig() {
  const config = protocol.telemetry.acceptanceReport;
  if (!config) {
    throw new Error('testing: protocol data carries no acceptance-report descriptor');
  }
  return config;
}

/** The status the device sends when it accepted the connection. */
export const ACCEPTANCE_STATUS_OK = acceptanceConfig().acceptedStatus;

export { isCoreStateRead };

/**
 * True when the write is the last frame of the connect handshake — the one
 * the device answers with its acceptance report.
 */
export function isHandshakeFinishWrite(data: Uint8Array): boolean {
  return data.length === HANDSHAKE_FINISH.length && data.every((b, i) => b === HANDSHAKE_FINISH[i]);
}

/**
 * Build the device's acceptance report.
 *
 * Pass a status other than {@link ACCEPTANCE_STATUS_OK} to simulate a device
 * that refused the connection.
 */
export function buildAcceptanceReport(status: number = ACCEPTANCE_STATUS_OK): Uint8Array {
  const config = acceptanceConfig();
  const frame = new Uint8Array(config.frameLength);
  frame[0] = 0x55;
  frame[1] = config.frameLength;
  frame[config.cmdByteOffset] = config.cmdValue;
  config.identifierBytes.forEach((b, i) => {
    frame[config.identifierOffset + i] = b;
  });
  frame[config.statusOffset] = status;
  return frame;
}

/** Values a simulated device reports in answer to the core-state read. */
export interface CoreStateReply {
  weight: number;
  motorEngaged: boolean;
  trainingMode: TrainingMode;
}

/** Build the device's reply to the core-state read. */
export function buildCoreStateReply(values: CoreStateReply): Uint8Array {
  const [weightField, motorField, modeField] = CORE_STATE_FIELDS;
  return encodeBulkParamResponse([
    { paramIdHex: weightField, value: values.weight },
    {
      paramIdHex: motorField,
      value: values.motorEngaged ? MOTOR_REPORT_VALUES.engaged : MOTOR_REPORT_VALUES.released,
    },
    { paramIdHex: modeField, value: values.trainingMode },
  ]);
}

/** Values a stub device reports unless a test says otherwise. */
export const DEFAULT_SIMULATED_STATE: CoreStateReply = {
  weight: 50,
  motorEngaged: false,
  trainingMode: TrainingMode.WeightTraining,
};

/**
 * The reply a device owes for a connect-setup write, or `null` when the write
 * is not one the device answers.
 *
 * Drop this into a stub transport's `write()` so `connect()` completes:
 *
 * ```ts
 * const reply = connectSetupReply(data);
 * if (reply) this.emitNotification(reply);
 * ```
 */
export function connectSetupReply(
  data: Uint8Array,
  state: CoreStateReply = DEFAULT_SIMULATED_STATE
): Uint8Array | null {
  if (isHandshakeFinishWrite(data)) return buildAcceptanceReport();
  if (isCoreStateRead(data)) return buildCoreStateReply(state);
  return null;
}
