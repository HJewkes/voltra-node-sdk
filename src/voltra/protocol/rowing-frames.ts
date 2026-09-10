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

// CMD bytes (from the protocol — kept as in-file constants to minimise the
// blast radius of protocol-derived knowledge).
const CMD_PARAM_WRITE = 0x11;
const CMD_VENDOR = 0xaa;

// Parameter id wire-bytes for the screen-switch. The SDK encodes paramIds
// MSB-first on the wire, so these two constants are the canonical paramId's
// bytes in little-endian order.
const EP_SCR_SWITCH_PARAMID_LO = 0x65;
const EP_SCR_SWITCH_PARAMID_HI = 0x51;

// Constant trailing bytes shared by every rowing screen-switch payload. The
// first is the rowing screen id; the rest are fixed across every frame
// observed on-device.
const ROWING_SCREEN_ID = 0x3e;
const ROWING_SCR_SWITCH_TRAILER: readonly [number, number, number] = [ROWING_SCREEN_ID, 0x00, 0x01];

/**
 * Action codes for the first byte of the rowing screen-switch payload.
 *
 * Both `JustRow` and `M50` are independently verified; the
 * 100/500/1000/2000/5000 m codes are inferred by sequential numbering.
 */
export const ROW_START_ACTION_CODES = {
  /** Just Row — no preset distance. */
  JustRow: 0x03,
  M50: 0x06,
  M100: 0x07,
  M500: 0x08,
  M1000: 0x09,
  M2000: 0x0a,
  M5000: 0x0b,
} as const;

export type RowStartActionKey = keyof typeof ROW_START_ACTION_CODES;

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
    EP_SCR_SWITCH_PARAMID_LO,
    EP_SCR_SWITCH_PARAMID_HI,
    action & 0xff,
    ROWING_SCR_SWITCH_TRAILER[0],
    ROWING_SCR_SWITCH_TRAILER[1],
    ROWING_SCR_SWITCH_TRAILER[2],
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
  return buildEnvelopedFrame(CMD_PARAM_WRITE, buildRowScrSwitchPayload(actionCode), {
    sequence: opts.sequence,
  });
}

/**
 * Build the vendor state-refresh frame. Sent immediately
 * after every screen-switch commit and on every reassert tick.
 */
export function buildVendorStateRefreshFrame(opts: { sequence?: number } = {}): Uint8Array {
  return buildEnvelopedFrame(CMD_VENDOR, new Uint8Array([0x13, 0x01]), {
    sequence: opts.sequence,
  });
}
