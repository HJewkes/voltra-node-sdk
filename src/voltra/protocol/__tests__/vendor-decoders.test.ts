/**
 * Vendor frame decoder tests.
 *
 * Each typed decoder is exercised against:
 *   - a synthesized frame built from the regen field offsets
 *   - cross-sub-type rejection (decoder returns null when given an
 *     unrelated sub-type)
 *   - truncation rejection (decoder returns null when frame is below
 *     the configured `frameLength`)
 *
 * `decodeVendorPerRep` also has one end-to-end test against a real
 * on-device capture from voltra-private's phase-5 validation session
 * (2026-05-06, VTR-212006). Inline hex is used rather than reading from
 * disk so the test stays self-contained in CI.
 */
import { describe, it, expect } from 'vitest';
import {
  decodeVendorPerRep,
  decodeVendorSummary,
  decodeVendorPreSummary,
  decodeVendorInProgress,
} from '../telemetry-decoder';
import { VendorMessages, VendorSchemaVersion } from '../constants';
import { hexToBytes } from '../../../shared/utils';
import { buildVendorPerRepFrame, buildVendorSummaryFrame } from '../_factories';
import { calculateCRC16 } from '../_factories/checksum.generated';

// =============================================================================
// Helpers
// =============================================================================

function frameOffsetOf(payloadOffset: number): number {
  return VendorMessages.cmdByteOffset + 1 + payloadOffset;
}

/** Recompute the trailing CRC16 after mutating frame bytes in place. */
function refreshCrc(frame: Uint8Array): void {
  const crc = calculateCRC16(frame.subarray(0, frame.length - 2));
  frame[frame.length - 2] = crc & 0xff;
  frame[frame.length - 1] = (crc >> 8) & 0xff;
}

function writeUint16LE(frame: Uint8Array, offset: number, value: number): void {
  frame[offset] = value & 0xff;
  frame[offset + 1] = (value >> 8) & 0xff;
}

function writeUint32LE(frame: Uint8Array, offset: number, value: number): void {
  frame[offset] = value & 0xff;
  frame[offset + 1] = (value >> 8) & 0xff;
  frame[offset + 2] = (value >> 16) & 0xff;
  frame[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * Build a perRep frame and patch the targetWeightTenths field that the
 * factory's typed signature doesn't yet accept.
 */
function buildPerRepFrameWithWeight(fields: {
  motionPhase: 'pull' | 'return';
  frameCounter: number;
  setCounter: number;
  repCount: number;
  targetWeightTenths: number;
}): Uint8Array {
  const cfg = VendorMessages.subTypes.perRep;
  if (!cfg.fields) throw new Error('perRep fields missing from regen');
  const frame = new Uint8Array(
    buildVendorPerRepFrame({
      motionPhase: fields.motionPhase,
      frameCounter: fields.frameCounter,
      setCounter: fields.setCounter,
      repCount: fields.repCount,
    })
  );
  writeUint16LE(
    frame,
    frameOffsetOf(cfg.fields.targetWeightTenths.payloadOffset),
    fields.targetWeightTenths
  );
  refreshCrc(frame);
  return frame;
}

/**
 * Build a vendor preSummary frame from scratch — no factory exists yet.
 *
 * Layout (frame offsets):
 *   0..3   universal header (start marker, length, category, header CRC8)
 *   4..5   sender/receiver (DEVICE_TO_APP)
 *   6..7   sequence (LE uint16)
 *   8..9   header suffix (constant)
 *   10     cmd byte (0xAA)
 *   11..   payload (sub-type identifier + fields, zero-padded)
 *   N-2..N-1 CRC16 (LE)
 *
 * We piggy-back on `buildVendorSummaryFrame` for the envelope/CRC, then
 * rewrite the identifier bytes + relevant fields.
 */
function buildPreSummaryFrame(fields: {
  schemaVersion: VendorSchemaVersion;
  targetWeightTenths: number;
  repCount: number;
  repDurationMs: number;
}): Uint8Array {
  const cfg = VendorMessages.subTypes.preSummary;
  if (cfg.frameLength == null || !cfg.fields || cfg.schemaVersionByteOffset === undefined) {
    throw new Error('preSummary metadata not populated');
  }

  // Use buildVendorSummaryFrame as a vehicle then rewrite identifier +
  // fields. Both are vendor sub-types behind cmd 0xAA.
  const summaryFrame = buildVendorSummaryFrame({
    schemaVersion: fields.schemaVersion,
    setCounter: 0,
    repCount: 0,
  });

  // Allocate a frame of preSummary's documented frameLength and copy the
  // envelope (offsets 0..10) from the summary scaffold. The header CRC8 at
  // frame[3] is left stale — decoders only validate length + sub-type bytes,
  // not the header CRC.
  const frame = new Uint8Array(cfg.frameLength);
  for (let i = 0; i < 11; i++) frame[i] = summaryFrame[i];
  frame[1] = cfg.frameLength;

  // Set sub-type identifier bytes at payload offsets 0..1.
  frame[VendorMessages.cmdByteOffset + 1] = cfg.identifierBytes[0];
  frame[VendorMessages.cmdByteOffset + 2] = cfg.identifierBytes[1];
  // Schema version byte.
  frame[frameOffsetOf(cfg.schemaVersionByteOffset)] = fields.schemaVersion & 0xff;
  // targetWeightTenths (uint16 LE).
  writeUint16LE(
    frame,
    frameOffsetOf(cfg.fields.targetWeightTenths.payloadOffset),
    fields.targetWeightTenths
  );
  // repCount (uint16 LE).
  writeUint16LE(frame, frameOffsetOf(cfg.fields.repCount.payloadOffset), fields.repCount);
  // repDurationMs (uint32 LE).
  writeUint32LE(frame, frameOffsetOf(cfg.fields.repDurationMs.payloadOffset), fields.repDurationMs);

  refreshCrc(frame);
  return frame;
}

/**
 * Build a 79-byte inProgress frame from scratch.
 *
 * The regen has no `fields` block for inProgress — offsets are hardcoded
 * per the 2026-05-06 validation handoff. We build the envelope by hand
 * using the same sequence/sender bytes as buildVendorSummaryFrame.
 */
function buildInProgressFrame(fields: {
  peakForceTenths: number;
  currentForceTenths: number;
  velocityCmPerSec: number;
  targetWeightTenths: number;
}): Uint8Array {
  const cfg = VendorMessages.subTypes.inProgress;
  const frameLength = cfg.frameLength ?? 79;

  // Borrow envelope from a summary frame.
  const summaryFrame = buildVendorSummaryFrame({
    schemaVersion: VendorSchemaVersion.Weight,
    setCounter: 0,
    repCount: 0,
  });
  const frame = new Uint8Array(frameLength);
  for (let i = 0; i < 11; i++) frame[i] = summaryFrame[i];
  frame[1] = frameLength;

  // Sub-type identifier bytes (2 bytes).
  frame[VendorMessages.cmdByteOffset + 1] = cfg.identifierBytes[0];
  frame[VendorMessages.cmdByteOffset + 2] = cfg.identifierBytes[1];

  // Hardcoded field offsets (same as in telemetry-decoder.ts).
  writeUint16LE(frame, 17, fields.peakForceTenths);
  writeUint16LE(frame, 25, fields.currentForceTenths);
  writeUint16LE(frame, 28, fields.velocityCmPerSec);
  writeUint32LE(frame, 49, fields.targetWeightTenths);

  refreshCrc(frame);
  return frame;
}

// =============================================================================
// decodeVendorPerRep
// =============================================================================

describe('decodeVendorPerRep', () => {
  it('decodes a synthesized perRep frame with all fields', () => {
    const frame = buildPerRepFrameWithWeight({
      motionPhase: 'pull',
      frameCounter: 26,
      setCounter: 3,
      repCount: 0,
      targetWeightTenths: 500,
    });

    const event = decodeVendorPerRep(frame);

    expect(event).not.toBeNull();
    expect(event!.phase).toBe('pull');
    expect(event!.frameCounter).toBe(26);
    expect(event!.setCounter).toBe(3);
    expect(event!.repCount).toBe(0);
    expect(event!.targetWeightTenths).toBe(500);
  });

  it('decodes motionPhase 2 as "return"', () => {
    const frame = buildPerRepFrameWithWeight({
      motionPhase: 'return',
      frameCounter: 27,
      setCounter: 3,
      repCount: 0,
      targetWeightTenths: 500,
    });

    const event = decodeVendorPerRep(frame);

    expect(event!.phase).toBe('return');
  });

  it('returns null for an unrelated sub-type (summary)', () => {
    const summary = buildVendorSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      setCounter: 1,
      repCount: 5,
    });

    const event = decodeVendorPerRep(summary);

    expect(event).toBeNull();
  });

  it('returns null for a truncated perRep frame', () => {
    const frame = buildPerRepFrameWithWeight({
      motionPhase: 'pull',
      frameCounter: 0,
      setCounter: 0,
      repCount: 0,
      targetWeightTenths: 0,
    });
    const truncated = frame.slice(0, frame.length - 1);

    const event = decodeVendorPerRep(truncated);

    expect(event).toBeNull();
  });

  it('decodes a real on-device perRep capture (50 lb weight mode)', () => {
    // Captured 2026-05-06 from VTR-212006 during voltra-private's phase-5
    // validation session (block D, 50 lb weight mode). Label in the
    // capture file: `vendor.perRep`. Inline rather than disk-read for CI
    // portability — capture file lives in a sibling repo not guaranteed
    // to be checked out alongside this one.
    const realCaptureHex =
      '554a04c610aa4a072000aa823b011a03000000f4010000000000005203810282038102cb00000075000000f40100004a060000010000520375000000bc0000004a060000000000006f1f';
    const frame = hexToBytes(realCaptureHex);

    const event = decodeVendorPerRep(frame);

    expect(event).not.toBeNull();
    expect(event!.phase).toBe('pull');
    expect(event!.targetWeightTenths).toBe(500); // 50.0 lb × 10
  });
});

// =============================================================================
// decodeVendorSummary
// =============================================================================

describe('decodeVendorSummary', () => {
  it('decodes a synthesized summary frame with all fields', () => {
    const frame = buildVendorSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      setCounter: 7,
      repCount: 12,
    });

    const event = decodeVendorSummary(frame);

    expect(event).not.toBeNull();
    expect(event!.schemaVersion).toBe(VendorSchemaVersion.Weight);
    expect(event!.setCounter).toBe(7);
    expect(event!.repCount).toBe(12);
    expect(event!.raw).toBeInstanceOf(Uint8Array);
    expect(event!.raw.length).toBe(frame.length);
  });

  it('returns null for an unrelated sub-type (perRep)', () => {
    const perRep = buildVendorPerRepFrame({
      motionPhase: 'pull',
      frameCounter: 1,
      setCounter: 1,
      repCount: 1,
    });

    const event = decodeVendorSummary(perRep);

    expect(event).toBeNull();
  });

  it('returns null for a truncated summary frame', () => {
    const frame = buildVendorSummaryFrame({
      schemaVersion: VendorSchemaVersion.Damper,
      setCounter: 0,
      repCount: 0,
    });
    const truncated = frame.slice(0, 50);

    const event = decodeVendorSummary(truncated);

    expect(event).toBeNull();
  });
});

// =============================================================================
// decodeVendorPreSummary
// =============================================================================

describe('decodeVendorPreSummary', () => {
  it('decodes a synthesized preSummary frame with all fields', () => {
    const frame = buildPreSummaryFrame({
      schemaVersion: VendorSchemaVersion.Damper,
      targetWeightTenths: 0,
      repCount: 5,
      repDurationMs: 4321,
    });

    const event = decodeVendorPreSummary(frame);

    expect(event).not.toBeNull();
    expect(event!.schemaVersion).toBe(VendorSchemaVersion.Damper);
    expect(event!.trainingMode).toBe(VendorSchemaVersion.Damper);
    expect(event!.targetWeightTenths).toBe(0);
    expect(event!.repCount).toBe(5);
    expect(event!.repDurationMs).toBe(4321);
    expect(event!.raw).toBeInstanceOf(Uint8Array);
  });

  it('returns null for an unrelated sub-type (summary)', () => {
    const summary = buildVendorSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      setCounter: 1,
      repCount: 5,
    });

    const event = decodeVendorPreSummary(summary);

    expect(event).toBeNull();
  });

  it('returns null for a truncated preSummary frame', () => {
    const frame = buildPreSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      targetWeightTenths: 500,
      repCount: 5,
      repDurationMs: 1000,
    });
    const truncated = frame.slice(0, 50);

    const event = decodeVendorPreSummary(truncated);

    expect(event).toBeNull();
  });
});

// =============================================================================
// decodeVendorInProgress
// =============================================================================

describe('decodeVendorInProgress', () => {
  it('decodes a synthesized inProgress frame with all fields', () => {
    const frame = buildInProgressFrame({
      peakForceTenths: 1234,
      currentForceTenths: 800,
      velocityCmPerSec: 50,
      targetWeightTenths: 500,
    });

    const event = decodeVendorInProgress(frame);

    expect(event).not.toBeNull();
    expect(event!.peakForceTenths).toBe(1234);
    expect(event!.currentForceTenths).toBe(800);
    expect(event!.velocityCmPerSec).toBe(50);
    expect(event!.targetWeightTenths).toBe(500);
    expect(event!.raw).toBeInstanceOf(Uint8Array);
  });

  it('returns null for an unrelated sub-type (summary)', () => {
    const summary = buildVendorSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      setCounter: 1,
      repCount: 5,
    });

    const event = decodeVendorInProgress(summary);

    expect(event).toBeNull();
  });

  it('returns null for a truncated inProgress frame', () => {
    const frame = buildInProgressFrame({
      peakForceTenths: 0,
      currentForceTenths: 0,
      velocityCmPerSec: 0,
      targetWeightTenths: 0,
    });
    const truncated = frame.slice(0, 30);

    const event = decodeVendorInProgress(truncated);

    expect(event).toBeNull();
  });
});
