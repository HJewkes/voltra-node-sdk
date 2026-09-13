/**
 * Rowing-mode frame builders — Bug 22
 *
 * Two-stage Rowing entry uses two protocol primitives that were not in the
 * pre-0.6.x SDK surface:
 *
 *   - a screen-switch write that commits the device
 *     into a rowing sub-screen. The first byte is the per-preset action code
 *     (Just-Row / 50 m / 100 m / ...); the remaining three are constant.
 *
 *   - the vendor "state refresh" pulse, which the device expects shortly
 *     after every screen-switch commit.
 *
 * Important: the SDK's existing parametric command builder
 * (`buildCommandBytes`) is hard-wired for fixed-width numeric values
 * (uint8/uint16/int16/uint32). The screen-switch carries a composite
 * action payload and so is built here directly via {@link buildEnvelopedFrame}.
 */

import { buildEnvelopedFrame } from './_factories/frame-factories.generated';
import protocolData from './data/protocol-data.generated';
import type { ParameterCatalogEntry, ProtocolData } from './types';
import { hexToBytes } from '../../shared/utils';

const protocol = protocolData as ProtocolData;
const rowing = protocol.commands.rowing;

function catalogEntry(key: string): ParameterCatalogEntry {
  const entry = protocol.telemetry.parameterCatalog?.[key];
  if (!entry) {
    throw new Error(`rowing-frames: protocol data has no parameter catalog entry for '${key}'`);
  }
  return entry;
}

/** Screen-switch register's paramId bytes, in the order the wire uses. */
const SCREEN_SWITCH_PARAM_ID_BYTES = hexToBytes(catalogEntry(rowing.screenSwitchParamField).wireLE);

const SCREEN_SWITCH_TRAILER = hexToBytes(rowing.screenSwitchTrailer);

/**
 * Action codes for the first byte of the rowing screen-switch payload.
 *
 * Both `JustRow` and `M50` are independently verified; the
 * 100/500/1000/2000/5000 m codes are inferred by sequential numbering.
 */
export const ROW_START_ACTION_CODES = rowing.actionCodes as Record<RowStartActionKey, number>;

export type RowStartActionKey = 'JustRow' | 'M50' | 'M100' | 'M500' | 'M1000' | 'M2000' | 'M5000';

/**
 * Build the parametric write payload (i.e. the bytes that go after the
 * cmd byte in the framed envelope) for a rowing screen-switch commit.
 */
function buildRowScrSwitchPayload(action: number): Uint8Array {
  // Layout: a uint16 LE count of 1, the paramId bytes, the action code,
  // then the constant trailer.
  return new Uint8Array([
    0x01,
    0x00,
    ...SCREEN_SWITCH_PARAM_ID_BYTES,
    action & 0xff,
    ...SCREEN_SWITCH_TRAILER,
  ]);
}

/**
 * Build the frame that commits the device into the requested
 * rowing sub-screen (Just Row or a distance preset).
 */
export function buildRowScrSwitchFrame(
  actionCode: number,
  opts: { sequence?: number } = {}
): Uint8Array {
  return buildEnvelopedFrame(
    hexToBytes(rowing.screenSwitchCmd)[0],
    buildRowScrSwitchPayload(actionCode),
    { sequence: opts.sequence }
  );
}

/**
 * Build the vendor state-refresh frame. Sent immediately
 * after every screen-switch commit and on every reassert tick.
 */
export function buildVendorStateRefreshFrame(opts: { sequence?: number } = {}): Uint8Array {
  return buildEnvelopedFrame(hexToBytes(rowing.vendorCmd)[0], hexToBytes(rowing.vendorRefreshPayload), {
    sequence: opts.sequence,
  });
}
