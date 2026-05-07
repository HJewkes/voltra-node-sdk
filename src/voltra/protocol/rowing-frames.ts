/**
 * Rowing-mode frame builders — Bug 22
 *
 * Two-stage Rowing entry uses two protocol primitives that were not in the
 * pre-0.6.x SDK surface:
 *
 *   - `EP_SCR_SWITCH` (LE paramId `0x5165`) — a 4-byte action-code write
 *     that commits the device into a rowing sub-screen. The first byte is
 *     the per-preset action code (Just-Row / 50 m / 100 m / ...); the
 *     remaining three bytes are constant `[0x3E, 0x00, 0x01]`.
 *
 *   - `0xAA 0x13 0x01` — the vendor "state refresh" pulse the device
 *     expects shortly after every `EP_SCR_SWITCH` commit.
 *
 * Source of truth (rationale, action-code table, reassert cadence):
 *   voltra-private/research/rowing-protocol-2026-05-06-android-deep.md §1, §2, §7.
 *
 * Important: the SDK's existing parametric command builder
 * (`buildCommandBytes`) is hard-wired for fixed-width numeric values
 * (uint8/uint16/int16/uint32). EP_SCR_SWITCH carries a 4-byte composite
 * action payload and so is built here directly via {@link buildEnvelopedFrame}.
 */

import { buildEnvelopedFrame } from './_factories/frame-factories.generated';

// CMD bytes (from the protocol — kept as in-file constants to minimise the
// blast radius of protocol-derived knowledge).
const CMD_PARAM_WRITE = 0x11;
const CMD_VENDOR = 0xaa;

// Parameter id wire-bytes for EP_SCR_SWITCH. The SDK encodes paramIds
// MSB-first in the on-wire layout — `0x6551` becomes wire bytes `65 51`,
// which is the little-endian encoding of the canonical paramId `0x5165`.
const EP_SCR_SWITCH_PARAMID_LO = 0x65;
const EP_SCR_SWITCH_PARAMID_HI = 0x51;

// Constant trailing bytes shared by every rowing EP_SCR_SWITCH payload —
// the second byte (`0x3E`) is the rowing screen id; the remaining
// `[0x00, 0x01]` is fixed across all observed captures.
const ROWING_SCREEN_ID = 0x3e;
const ROWING_SCR_SWITCH_TRAILER: readonly [number, number, number] = [ROWING_SCREEN_ID, 0x00, 0x01];

/**
 * Action codes for the first byte of the EP_SCR_SWITCH rowing payload.
 *
 * Both `JustRow` and `M50` are independently verified against iPad
 * sysdiagnose captures; the 100/500/1000/2000/5000 m codes are inferred
 * by sequential numbering.
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
 * cmd byte in the framed envelope) for an EP_SCR_SWITCH rowing commit.
 */
function buildRowScrSwitchPayload(action: number): Uint8Array {
  // Layout: [count_lo=0x01, count_hi=0x00, paramId_lo, paramId_hi, action, 0x3E, 0x00, 0x01]
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
 * Build the EP_SCR_SWITCH frame that commits the device into the requested
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
 * Build the `0xAA 0x13 0x01` vendor state-refresh frame. Sent immediately
 * after every EP_SCR_SWITCH commit and on every reassert tick.
 */
export function buildVendorStateRefreshFrame(opts: { sequence?: number } = {}): Uint8Array {
  return buildEnvelopedFrame(CMD_VENDOR, new Uint8Array([0x13, 0x01]), {
    sequence: opts.sequence,
  });
}
