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
  decodeVendorSetSummary,
  decodeVendorInProgress,
} from '../telemetry-decoder';
import { VendorMessages, VendorSchemaVersion } from '../constants';
import { hexToBytes } from '../../../shared/utils';
import {
  buildVendorInProgressFrame,
  buildVendorPerRepFrame,
  buildVendorSummaryFrame,
} from '../_factories';
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
 * Build a vendor setSummary (`aa 85 5f`) frame from scratch — no factory exists yet.
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
function buildSetSummaryFrame(fields: {
  schemaVersion: VendorSchemaVersion;
  targetWeightTenths: number;
  repCount: number;
  totalPullMovingTimeMs: number;
  peakForceTenths?: number;
  peakPowerRaw?: number;
}): Uint8Array {
  const cfg = VendorMessages.subTypes.setSummary;
  if (cfg.frameLength == null || !cfg.fields || cfg.schemaVersionByteOffset === undefined) {
    throw new Error('setSummary metadata not populated');
  }

  // Use buildVendorSummaryFrame as a vehicle then rewrite identifier +
  // fields. Both are vendor sub-types behind cmd 0xAA.
  const summaryFrame = buildVendorSummaryFrame({
    schemaVersion: fields.schemaVersion,
    setCounter: 0,
    repCount: 0,
  });

  // Allocate a frame of setSummary's documented frameLength and copy the
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
  writeUint32LE(
    frame,
    frameOffsetOf(cfg.fields.totalPullMovingTimeMs.payloadOffset),
    fields.totalPullMovingTimeMs
  );
  writeUint16LE(
    frame,
    frameOffsetOf(cfg.fields.peakForceTenths.payloadOffset),
    fields.peakForceTenths ?? 0
  );
  writeUint32LE(
    frame,
    frameOffsetOf(cfg.fields.peakPowerRaw.payloadOffset),
    fields.peakPowerRaw ?? 0
  );

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

  it.each([255, 256])('reports a set counter of %i as the device counted it', (count) => {
    const frame = buildPerRepFrameWithWeight({
      motionPhase: 'pull',
      frameCounter: 1,
      setCounter: count,
      repCount: 0,
      targetWeightTenths: 500,
    });

    expect(decodeVendorPerRep(frame)!.setCounter).toBe(count);
  });

  it.each([255, 256])('reports a rep count of %i as the device counted it', (count) => {
    const frame = buildPerRepFrameWithWeight({
      motionPhase: 'pull',
      frameCounter: 1,
      setCounter: 0,
      repCount: count,
      targetWeightTenths: 500,
    });

    expect(decodeVendorPerRep(frame)!.repCount).toBe(count);
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

  it.each([255, 256])('reports a workout set counter of %i in full', (count) => {
    const frame = buildVendorSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      setCounter: count,
      repCount: 1,
    });

    expect(decodeVendorSummary(frame)!.setCounter).toBe(count);
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
// decodeVendorSetSummary
// =============================================================================

describe('decodeVendorSetSummary', () => {
  it('decodes a synthesized setSummary frame with all fields', () => {
    const frame = buildSetSummaryFrame({
      schemaVersion: VendorSchemaVersion.Damper,
      targetWeightTenths: 0,
      repCount: 5,
      totalPullMovingTimeMs: 4321,
      peakForceTenths: 812,
      peakPowerRaw: 77,
    });

    const event = decodeVendorSetSummary(frame);

    expect(event).not.toBeNull();
    expect(event!.schemaVersion).toBe(VendorSchemaVersion.Damper);
    expect(event!.targetWeightTenths).toBe(0);
    expect(event!.repCount).toBe(5);
    expect(event!.totalPullMovingTimeMs).toBe(4321);
    expect(event!.peakForceTenths).toBe(812);
    expect(event!.peakPowerRaw).toBe(77);
    expect(event!.raw).toBeInstanceOf(Uint8Array);
  });

  it('returns null for an unrelated sub-type (summary)', () => {
    const summary = buildVendorSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      setCounter: 1,
      repCount: 5,
    });

    const event = decodeVendorSetSummary(summary);

    expect(event).toBeNull();
  });

  it('returns null for a truncated setSummary frame', () => {
    const frame = buildSetSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      targetWeightTenths: 500,
      repCount: 5,
      totalPullMovingTimeMs: 1000,
    });
    const truncated = frame.slice(0, 50);

    const event = decodeVendorSetSummary(truncated);

    expect(event).toBeNull();
  });
});

describe('decodeVendorSetSummary — set totals', () => {
  it('carries two unequal pull times as their total, not the last one', () => {
    // A two-rep set whose pulls took 2500 ms and 5200 ms. The field holds
    // 7700, so a decoder that read it as the final rep's duration would have
    // to report 5200 and fails here.
    const firstPullMs = 2500;
    const secondPullMs = 5200;
    const frame = buildSetSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      targetWeightTenths: 200,
      repCount: 2,
      totalPullMovingTimeMs: firstPullMs + secondPullMs,
    });

    const event = decodeVendorSetSummary(frame);

    expect(event!.totalPullMovingTimeMs).toBe(7700);
    expect(event!.totalPullMovingTimeMs).not.toBe(secondPullMs);
  });

  it('reads a peak power past what two bytes hold', () => {
    const frame = buildSetSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      targetWeightTenths: 200,
      repCount: 1,
      totalPullMovingTimeMs: 1000,
      peakPowerRaw: 70000,
    });

    expect(decodeVendorSetSummary(frame)!.peakPowerRaw).toBe(70000);
  });
});

// =============================================================================
// decodeVendorSetSummary — peak aggregates against real captures
//
// The peak-force / peak-power offsets are hypothesised, not vendor-confirmed.
// These fixtures pin them against sets whose set-up conditions are known, so
// the hypothesis is a standing regression rather than a one-off offline check.
// Frames are inlined for CI portability (the capture files live in a sibling
// repo that is not guaranteed to be checked out alongside this one).
// =============================================================================

/** Weight mode, 20.0 lb target, eleven reps at a steady pace. */
const CAPTURE_WEIGHT_20LB_11REPS =
  '556e043c10aa45092000aa855f010204c80000000000000004000b008d01cf0c47020000dc0061055c000000d600f507bb000000c800e40230000000142800000c120000710900005378000011ac0600f80300008c0300005c000000530000004d2b0000630100004d490000c7b2';

/** Weight mode, 20.0 lb target, one deliberately fast rep. */
const CAPTURE_WEIGHT_20LB_FAST =
  '556e043c10aa14062000aa855f010203c80000000000000001000100e300de0a02010000d300650581000000d00046057b000000c900fb02430000007a0300009a010000d2000000e411000000000000530000004d000000540000004e0000008502000000000000830400009e6f';

/** Weight mode, 20.0 lb target, one deliberately slow rep — same load as above. */
const CAPTURE_WEIGHT_20LB_SLOW =
  '556e043c10aaf9062000aa855f010203c80000000000000002000100ce00aa0126000000c900160118000000cd00bd0240000000c9002d011b0000000c08000090010000c8000000b626000051890200b2000000b7000000b3000000b8000000b61c000055000000a91a0000c2fb';

/** Weight mode, 50.0 lb target, one rep. */
const CAPTURE_WEIGHT_50LB =
  '556e043c10aa8b072000aa855f010203f40100000000000003000100f9018203cb000000f501110275000000f8017b0156000000f50120013f00000052030000e8030000f40100004d170000d6ac0400bc000000b8000000bd000000b90000004a060000000000006d0b000034a5';

/** Damper mode, three reps — no target weight. */
const CAPTURE_DAMPER_3REPS =
  '556e043c10aa88012000aa855f030203000000000000080001000300840221057f010000740151027f0000006900cb032d000000640061021a00000074090000870500005b0400002328000000000000fd01000069000000aa00000023000000a50f0000a0000000c80f0000a3d3';

describe('decodeVendorSetSummary peak aggregates (real captures)', () => {
  it('reads peak force at or just above the 20 lb target', () => {
    const event = decodeVendorSetSummary(hexToBytes(CAPTURE_WEIGHT_20LB_FAST));

    expect(event).not.toBeNull();
    expect(event!.schemaVersion).toBe(VendorSchemaVersion.Weight);
    expect(event!.targetWeightTenths).toBe(200); // 20.0 lb × 10
    expect(event!.peakForceTenths).toBe(227); // 22.7 lb — overshoot above target
    expect(event!.peakForceTenths).toBeGreaterThanOrEqual(event!.targetWeightTenths);
  });

  it('reads peak force at or just above the 50 lb target', () => {
    const event = decodeVendorSetSummary(hexToBytes(CAPTURE_WEIGHT_50LB));

    expect(event).not.toBeNull();
    expect(event!.targetWeightTenths).toBe(500); // 50.0 lb × 10
    expect(event!.peakForceTenths).toBe(505); // 50.5 lb
    expect(event!.peakForceTenths).toBeGreaterThanOrEqual(event!.targetWeightTenths);
  });

  it('reads an untargeted peak force in damper mode', () => {
    const event = decodeVendorSetSummary(hexToBytes(CAPTURE_DAMPER_3REPS));

    expect(event).not.toBeNull();
    expect(event!.schemaVersion).toBe(VendorSchemaVersion.Damper);
    expect(event!.targetWeightTenths).toBe(0); // damper carries no target
    expect(event!.repCount).toBe(3);
    expect(event!.peakForceTenths).toBe(644); // 64.4 lb, set by the user's effort
  });

  it('reports a much larger peak power for a fast rep than a slow rep at the same load', () => {
    const fast = decodeVendorSetSummary(hexToBytes(CAPTURE_WEIGHT_20LB_FAST));
    const slow = decodeVendorSetSummary(hexToBytes(CAPTURE_WEIGHT_20LB_SLOW));

    // Same target weight, same rep count — only rep speed differs.
    expect(fast!.targetWeightTenths).toBe(slow!.targetWeightTenths);
    expect(fast!.repCount).toBe(1);
    expect(slow!.repCount).toBe(1);
    expect(fast!.totalPullMovingTimeMs).toBeLessThan(slow!.totalPullMovingTimeMs);

    // Magnitudes are in unverified units; the ratio is the assertable signal.
    expect(fast!.peakPowerRaw).toBe(258);
    expect(slow!.peakPowerRaw).toBe(38);
    expect(fast!.peakPowerRaw / slow!.peakPowerRaw).toBeGreaterThan(5);
  });

  it('reports similar peak force for fast and slow reps at the same load', () => {
    const fast = decodeVendorSetSummary(hexToBytes(CAPTURE_WEIGHT_20LB_FAST));
    const slow = decodeVendorSetSummary(hexToBytes(CAPTURE_WEIGHT_20LB_SLOW));

    // Peak force is load-bound, so it must not swing with speed the way
    // peak power does — this guards against the two offsets being confused.
    expect(fast!.peakForceTenths).toBe(227);
    expect(slow!.peakForceTenths).toBe(206);
  });

  it('totals the set rather than timing one rep', () => {
    // Eleven reps at a steady pace against one rep at the same load: the
    // eleven-rep set reports 11085 ms where one rep of that pace is about a
    // second. A per-rep duration could not do that.
    const manyReps = decodeVendorSetSummary(hexToBytes(CAPTURE_WEIGHT_20LB_11REPS));
    const oneFastRep = decodeVendorSetSummary(hexToBytes(CAPTURE_WEIGHT_20LB_FAST));

    expect(manyReps!.repCount).toBe(11);
    expect(oneFastRep!.repCount).toBe(1);
    expect(manyReps!.totalPullMovingTimeMs).toBe(11085);
    expect(oneFastRep!.totalPullMovingTimeMs).toBe(645);
    expect(manyReps!.totalPullMovingTimeMs).toBeGreaterThan(
      oneFastRep!.totalPullMovingTimeMs * manyReps!.repCount * 0.5
    );
  });
});

// =============================================================================
// decodeVendorInProgress
// =============================================================================

describe('decodeVendorInProgress', () => {
  // Distinct per field: the two mean forces, the mean return speed and the
  // accumulated pull volume all differ, so a decoder reading any one of them
  // from another's offset fails rather than agreeing by coincidence.
  const distinct = {
    meanPullForceTenths: 1500,
    meanReturnForceTenths: 1234,
    meanReturnSpeedMmPerSec: 507,
    pullVolumeRawTenths: 70000,
  };

  it('decodes each field from its own offset', () => {
    const event = decodeVendorInProgress(buildVendorInProgressFrame(distinct));

    expect(event).not.toBeNull();
    expect(event!.meanPullForceTenths).toBe(1500);
    expect(event!.meanReturnForceTenths).toBe(1234);
    expect(event!.meanReturnSpeedMmPerSec).toBe(507);
    expect(event!.pullVolumeRawTenths).toBe(70000);
    expect(event!.raw).toBeInstanceOf(Uint8Array);
  });

  it('reads a return speed that does not run into the field after it', () => {
    // Read one byte late, the speed's high byte and the next field's low
    // byte combine into a value in the thousands. Pinning a four-figure
    // volume next to a three-figure speed is what makes that visible.
    const event = decodeVendorInProgress(buildVendorInProgressFrame(distinct));

    expect(event!.meanReturnSpeedMmPerSec).toBeLessThan(1000);
  });

  it('returns null for an unrelated sub-type (summary)', () => {
    const summary = buildVendorSummaryFrame({
      schemaVersion: VendorSchemaVersion.Weight,
      setCounter: 1,
      repCount: 5,
    });

    expect(decodeVendorInProgress(summary)).toBeNull();
  });

  it('returns null for a truncated inProgress frame', () => {
    const frame = buildVendorInProgressFrame(distinct);

    expect(decodeVendorInProgress(frame.slice(0, 30))).toBeNull();
  });
});
