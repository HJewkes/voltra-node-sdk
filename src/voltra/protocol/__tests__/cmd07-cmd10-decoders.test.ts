/**
 * Decoder tests for the cmd=0x07 (52-byte aa80-25 envelope) and cmd=0x10
 * (multi-length async-state cascade) paths added in Phase 1a.
 *
 * Hex frames are captured on-device fixtures from
 * `voltra-private/captures/sessions/validation-phase-7-cmd0x10-recon-
 * 2026-05-06T21-38-19.events.json` (Campaign 3, VTR-212006). They are
 * inlined here so the SDK test suite stays self-contained — the canonical
 * source remains in voltra-private.
 *
 * Rowing-frame fixtures (`aa 95 25`, `aa 92`, `aa 93`) are synthesized:
 * the only on-device Rowing capture (Campaign 6.A) failed to engage Rowing
 * mode (Bug 22), so the byte layouts come from the Android-deep-scrub
 * audit (`aa-subtype-catalog-2026-05-07-android-deep.md`) and are tested
 * against synthetic frames built to those offsets.
 */

import { describe, it, expect } from 'vitest';
import {
  decodeNotification,
  decodeStateDump,
  decodeCmd10,
  decodeRowingSummary,
  decodeRowingStatus,
  decodeWaveformChunk,
  identifyMessageType,
} from '../telemetry-decoder';
import { TrainingMode, ParamIdHex } from '../constants';
import { hexToBytes } from '../../../shared/utils';

// =============================================================================
// Phase 1a — captured frames (inlined from voltra-private capture)
// =============================================================================

/** cmd=0x10 single-param cascade: damperLevel=7 (uint8). */
const FRAME_CMD10_DAMPER_LEVEL_7 = '551204c710aa1c002000100100035107ebfc';

/** cmd=0x10 single-param cascade: chains=25lbs (uint16, 19-byte frame). */
const FRAME_CMD10_CHAINS_25 = '5513040310aaa1002000100100873e19000a48';

/** cmd=0x10 9-param full cascade after damperLevel set. */
const FRAME_CMD10_FULL_CASCADE_DAMPER =
  '552e04a710aa1d002000100900863e1900873e0000883e0000893e0000025102035107b04f00e14e012451004d4b';

/** cmd=0x10 9-param full cascade after chains set: chains=25lbs. */
const FRAME_CMD10_FULL_CASCADE_CHAINS =
  '552e04a710aaa2002000100900863e1900873e1900883e0000893e0400025102035109b04f01e14e012451005a92';

/** cmd=0x10 2-param structural / mode-switch (mode 8 = Isometric). */
const FRAME_CMD10_MODE_SWITCH_ISOMETRIC = '551604fc10aa3a002000100200893e8500b04f089a5e';

/** Trailer cmd=0x10 frame (post-cascade); 2 params, not all recognized. */
const FRAME_CMD10_TRAILER = '5518042010aa1e0020001002000f52011f5200000000fae6';

/** 52-byte cmd=0x07 state-dump: assist ON in WeightTraining mode. */
const FRAME_STATE_DUMP_ASSIST_ON =
  '553404ac10aa9e002000aa8025000200000000000000000000003300000000000000050101010000580201ec02000000000008af';

/** 52-byte cmd=0x07 state-dump: chains active at 25 lbs. */
const FRAME_STATE_DUMP_CHAINS_25 =
  '553404ac10aaa0002000aa8025010000fa00fa000000000000003300000000000000050301010000580201ec020000000000c0ba';

/** 52-byte cmd=0x07 state-dump: damperLevel set, no assist, no chains. */
const FRAME_STATE_DUMP_DAMPER_BASELINE =
  '553404ac10aa1b002000aa8025000000000000000000000000000000000000000000050301010000580201ec020000000000aa88';

// =============================================================================
// cmd=0x10 dispatch
// =============================================================================

describe('identifyMessageType - cmd=0x10 async-state', () => {
  it('classifies the 18-byte single-uint8 frame (damperLevel) as cmd10_async_state', () => {
    const data = hexToBytes(FRAME_CMD10_DAMPER_LEVEL_7);

    expect(identifyMessageType(data)).toBe('cmd10_async_state');
  });

  it('classifies the 19-byte single-uint16 frame (chains) as cmd10_async_state', () => {
    const data = hexToBytes(FRAME_CMD10_CHAINS_25);

    expect(identifyMessageType(data)).toBe('cmd10_async_state');
  });

  it('classifies the 22-byte 2-param mode-switch frame as cmd10_async_state', () => {
    const data = hexToBytes(FRAME_CMD10_MODE_SWITCH_ISOMETRIC);

    expect(identifyMessageType(data)).toBe('cmd10_async_state');
  });

  it('classifies the 46-byte 9-param cascade frame as cmd10_async_state', () => {
    const data = hexToBytes(FRAME_CMD10_FULL_CASCADE_CHAINS);

    expect(identifyMessageType(data)).toBe('cmd10_async_state');
  });
});

describe('decodeCmd10', () => {
  it('decodes a single uint8 param (damperLevel=7)', () => {
    const data = hexToBytes(FRAME_CMD10_DAMPER_LEVEL_7);

    const result = decodeCmd10(data);

    expect(result).not.toBeNull();
    expect(result!.paramCount).toBe(1);
    expect(result!.params).toHaveLength(1);
    expect(result!.params[0].paramIdHex).toBe('0351');
    expect(result!.params[0].value).toBe(7);
    expect(result!.params[0].byteLength).toBe(1);
  });

  it('decodes a single uint16 param (chains=25)', () => {
    const data = hexToBytes(FRAME_CMD10_CHAINS_25);

    const result = decodeCmd10(data);

    expect(result).not.toBeNull();
    expect(result!.paramCount).toBe(1);
    // Chains paramId is 0x873e (LE bytes -> 'CHAINS' constant in ParamIdHex).
    expect(result!.params[0].paramIdHex).toBe(ParamIdHex.CHAINS);
    expect(result!.params[0].value).toBe(25);
    expect(result!.params[0].byteLength).toBe(2);
  });

  it('decodes a 2-param mode-switch (fitness-mode + trainingMode=Isometric)', () => {
    const data = hexToBytes(FRAME_CMD10_MODE_SWITCH_ISOMETRIC);

    const result = decodeCmd10(data);

    expect(result).not.toBeNull();
    expect(result!.paramCount).toBe(2);
    expect(result!.params).toHaveLength(2);
    // Param 1: 0x3e89 (fitness-mode), uint16 LE value 0x0085.
    expect(result!.params[0].paramIdHex).toBe('893e');
    expect(result!.params[0].value).toBe(0x0085);
    expect(result!.params[0].byteLength).toBe(2);
    // Param 2: 0x4fb0 (trainingMode). Stored on-wire as uint8 (matches
    // existing settingsUpdate decode path); only the lower byte of mode
    // is sent for non-uint16 params, here 0x08 = Isometric.
    expect(result!.params[1].paramIdHex).toBe(ParamIdHex.TRAINING_MODE);
    expect(result!.params[1].value).toBe(TrainingMode.Isometric);
    expect(result!.params[1].byteLength).toBe(1);
  });

  it('decodes a 9-param full cascade (chains=25)', () => {
    const data = hexToBytes(FRAME_CMD10_FULL_CASCADE_CHAINS);

    const result = decodeCmd10(data);

    expect(result).not.toBeNull();
    expect(result!.paramCount).toBe(9);
    expect(result!.params).toHaveLength(9);
    const byId = new Map(result!.params.map((p) => [p.paramIdHex, p.value]));
    expect(byId.get(ParamIdHex.BASE_WEIGHT)).toBe(25);
    expect(byId.get(ParamIdHex.CHAINS)).toBe(25);
    expect(byId.get(ParamIdHex.TRAINING_MODE)).toBe(TrainingMode.WeightTraining);
  });

  it('returns null for a frame whose cmd byte is not 0x10', () => {
    const data = hexToBytes(FRAME_STATE_DUMP_ASSIST_ON);

    const result = decodeCmd10(data);

    expect(result).toBeNull();
  });
});

describe('decodeNotification - cmd=0x10 routing', () => {
  it('routes single TRAINING_MODE param to mode_confirmation', () => {
    // Synthesize the canonical setMode(WeightTraining) bootstrap envelope:
    // length 0x13, cmd=0x10, paramCount=1, paramId=b04f, value=01 (uint16).
    const hex = '551304ec10aa00002000100100b04f0100bbcc';
    const data = hexToBytes(hex);

    const result = decodeNotification(data);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('mode_confirmation');
    if (result?.type === 'mode_confirmation') {
      expect(result.mode).toBe(TrainingMode.WeightTraining);
    }
  });

  it('routes single damperLevel param to settings_update (NOT mode_confirmation)', () => {
    // Pre-fix: this 18-byte frame matched the legacy `mode_confirmation`
    // (header `5512`) path and was reported as `trainingMode = Idle (=0)`
    // (byte[15]=7 looks like value 7 which isn't a valid mode → fell back
    // to Idle). Post-fix: routes through cmd10_async_state and surfaces
    // damperLevel without claiming a spurious mode change.
    const data = hexToBytes(FRAME_CMD10_DAMPER_LEVEL_7);

    const result = decodeNotification(data);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('settings_update');
    if (result?.type === 'settings_update') {
      expect(result.settings.damperLevel).toBe(7);
      expect(result.settings.trainingMode).toBeUndefined();
    }
  });

  it('routes single chains uint16 param to settings_update', () => {
    const data = hexToBytes(FRAME_CMD10_CHAINS_25);

    const result = decodeNotification(data);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('settings_update');
    if (result?.type === 'settings_update') {
      expect(result.settings.chains).toBe(25);
    }
  });

  it('routes 2-param mode-switch to settings_update with trainingMode populated', () => {
    const data = hexToBytes(FRAME_CMD10_MODE_SWITCH_ISOMETRIC);

    const result = decodeNotification(data);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('settings_update');
    if (result?.type === 'settings_update') {
      expect(result.settings.trainingMode).toBe(TrainingMode.Isometric);
    }
  });

  it('routes 9-param full cascade to settings_update with all known fields', () => {
    const data = hexToBytes(FRAME_CMD10_FULL_CASCADE_CHAINS);

    const result = decodeNotification(data);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('settings_update');
    if (result?.type === 'settings_update') {
      expect(result.settings.baseWeight).toBe(25);
      expect(result.settings.chains).toBe(25);
      expect(result.settings.trainingMode).toBe(TrainingMode.WeightTraining);
      // Captured cascade has damperLevel=9 (UI level 10 — runs at damper
      // ceiling for chains-engaged sweep).
      expect(result.settings.damperLevel).toBe(9);
    }
  });

  it('routes the post-damper full cascade (chains=0) without spurious chains', () => {
    const data = hexToBytes(FRAME_CMD10_FULL_CASCADE_DAMPER);

    const result = decodeNotification(data);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('settings_update');
    if (result?.type === 'settings_update') {
      expect(result.settings.baseWeight).toBe(25);
      expect(result.settings.chains).toBe(0);
      // Damper-set frame: damperLevel=7 (UI level 8) lingers, mode=Idle
      // post-set since the cascade reflects the after-state of damper sweep.
      expect(result.settings.damperLevel).toBe(7);
      expect(result.settings.trainingMode).toBe(TrainingMode.Idle);
    }
  });

  it('routes trailer cascade (unrecognized params) to settings_update with empty bag', () => {
    const data = hexToBytes(FRAME_CMD10_TRAILER);

    const result = decodeNotification(data);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('settings_update');
    if (result?.type === 'settings_update') {
      // 0x520f / 0x521f are not in the curated paramIds set — bag is empty.
      expect(result.settings).toEqual({});
    }
  });
});

// =============================================================================
// cmd=0x07 — 52-byte aa80-25 state-dump envelope
// =============================================================================

describe('decodeStateDump', () => {
  it('decodes the assist-ON state dump (assistMode=2, transitional trainingMode)', () => {
    const data = hexToBytes(FRAME_STATE_DUMP_ASSIST_ON);

    const event = decodeStateDump(data);

    expect(event).not.toBeNull();
    expect(event!.assistMode).toBe(0x02);
    // raw[0] = 0x00 → transitional / mid-mode-switch (TrainingMode.Idle).
    expect(event!.trainingMode).toBe(TrainingMode.Idle);
    expect(event!.weightLbsTenths).toBe(0);
    expect(event!.chainTargetForceTenths).toBe(0);
    expect(event!.eccentricPercentTenths).toBe(0);
    // Raw payload is the 37 bytes following `aa 80 25` (excluding 2-byte CRC).
    expect(event!.raw).toHaveLength(37);
  });

  it('decodes the chains=25 state dump (WT mode, chains coerced to weight)', () => {
    const data = hexToBytes(FRAME_STATE_DUMP_CHAINS_25);

    const event = decodeStateDump(data);

    expect(event).not.toBeNull();
    // raw[0] = 0x01 → WeightTraining.
    expect(event!.trainingMode).toBe(TrainingMode.WeightTraining);
    expect(event!.assistMode).toBe(0x00);
    // Weight stored as uint16 LE tenths-of-pounds at payload offset 3:
    // 0xfa = 250 = 25.0 lbs.
    expect(event!.weightLbsTenths).toBe(250);
    // Effective chain force at offset 5 = min(chains, weight) × 10. With
    // chains=25 and weight=25 the effective chain force is 25.0 lbs.
    expect(event!.chainTargetForceTenths).toBe(250);
    expect(event!.eccentricPercentTenths).toBe(0);
  });

  it('decodes the damper-baseline state dump (transitional, all zero)', () => {
    const data = hexToBytes(FRAME_STATE_DUMP_DAMPER_BASELINE);

    const event = decodeStateDump(data);

    expect(event).not.toBeNull();
    expect(event!.assistMode).toBe(0);
    expect(event!.trainingMode).toBe(TrainingMode.Idle);
    expect(event!.weightLbsTenths).toBe(0);
    expect(event!.chainTargetForceTenths).toBe(0);
    expect(event!.eccentricPercentTenths).toBe(0);
  });

  it('returns null for a frame that is not aa-80-25', () => {
    const data = hexToBytes(FRAME_CMD10_FULL_CASCADE_CHAINS);

    const event = decodeStateDump(data);

    expect(event).toBeNull();
  });

  it('returns null for a truncated state-dump frame', () => {
    const fullFrame = hexToBytes(FRAME_STATE_DUMP_ASSIST_ON);
    const truncated = fullFrame.slice(0, 51);

    const event = decodeStateDump(truncated);

    expect(event).toBeNull();
  });
});

describe('identifyMessageType - cmd=0x07 / state dump', () => {
  it('classifies the 52-byte aa-80-25 frame as vendor_state_dump (NOT status_update)', () => {
    const data = hexToBytes(FRAME_STATE_DUMP_ASSIST_ON);

    expect(identifyMessageType(data)).toBe('vendor_state_dump');
  });
});

describe('decodeNotification - cmd=0x07 routing', () => {
  it('routes the 52-byte aa-80-25 frame to state_dump (replacing wrong device_status path)', () => {
    const data = hexToBytes(FRAME_STATE_DUMP_CHAINS_25);

    const result = decodeNotification(data);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('state_dump');
    if (result?.type === 'state_dump') {
      expect(result.event.trainingMode).toBe(TrainingMode.WeightTraining);
      expect(result.event.weightLbsTenths).toBe(250);
      expect(result.event.chainTargetForceTenths).toBe(250);
    }
  });
});

// =============================================================================
// Rowing telemetry — synthetic frames built to the Android-deep-scrub layout
// =============================================================================

/**
 * Synthesize a rowing summary frame with the documented byte layout. The
 * 6-byte envelope (`55 <len> 04 <crc8> 10 aa`) and 2-byte trailing CRC are
 * filled with zeros — `decodeRowingSummary` doesn't validate CRC, so this
 * is sufficient for byte-layout regression.
 *
 * Sub-type bytes `aa 95 25` start at frame offset 10. Payload offsets in
 * the params object are payload-relative (i.e. payload[0] = `0x95`).
 */
function buildRowingSummaryFrame(params: {
  strokeRateSpm: number;
  currentPaceTenthSeconds: number;
  averagePaceTenthSeconds: number;
  strokeCountCenti: number;
  distanceMeters: number;
}): Uint8Array {
  const frame = new Uint8Array(52);
  frame[0] = 0x55;
  frame[1] = 0x34;
  frame[2] = 0x04;
  frame[3] = 0xac;
  frame[4] = 0x10;
  frame[5] = 0xaa;
  // seq + proto (6..9): leave as zero.
  frame[10] = 0xaa;
  frame[11] = 0x95;
  frame[12] = 0x25;
  // Payload starts at frame[11]; the sub-type byte itself is payload[0].
  // strokeRateSpm at payload offset 2 = frame offset 13.
  frame[13] = params.strokeRateSpm & 0xff;
  // currentPace tenth-seconds at payload offsets 3..6 = frame 14..17.
  writeUint32LE(frame, 14, params.currentPaceTenthSeconds);
  // averagePace tenth-seconds at payload offsets 7..10 = frame 18..21.
  writeUint32LE(frame, 18, params.averagePaceTenthSeconds);
  // Stroke count *100 at payload offsets 19..22 = frame 30..33.
  writeUint32LE(frame, 30, params.strokeCountCenti);
  // Distance meters at payload offsets 35..38 = frame 46..49.
  writeUint32LE(frame, 46, params.distanceMeters);
  return frame;
}

function writeUint32LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

describe('decodeRowingSummary', () => {
  it('decodes pace as tenths-of-seconds → ms (×100)', () => {
    // Pace 1200 tenths-of-seconds = 120s = 2 min/500m → 120000 ms.
    const frame = buildRowingSummaryFrame({
      strokeRateSpm: 28,
      currentPaceTenthSeconds: 1200,
      averagePaceTenthSeconds: 1300,
      strokeCountCenti: 4200, // 42 strokes
      distanceMeters: 250,
    });

    const event = decodeRowingSummary(frame);

    expect(event).not.toBeNull();
    expect(event!.strokeRateSpm).toBe(28);
    expect(event!.currentPaceMs).toBe(120000);
    expect(event!.averagePaceMs).toBe(130000);
    expect(event!.strokeCount).toBe(42);
    expect(event!.distanceMeters).toBe(250);
  });

  it('decodes distance in meters (NOT centimeters — different from aa-92)', () => {
    const frame = buildRowingSummaryFrame({
      strokeRateSpm: 30,
      currentPaceTenthSeconds: 1100,
      averagePaceTenthSeconds: 1100,
      strokeCountCenti: 0,
      distanceMeters: 1000,
    });

    const event = decodeRowingSummary(frame);

    expect(event!.distanceMeters).toBe(1000);
  });

  it('returns null for a frame that is not aa-95-25', () => {
    const data = hexToBytes(FRAME_STATE_DUMP_ASSIST_ON);

    expect(decodeRowingSummary(data)).toBeNull();
  });

  it('returns null when the frame is too short to read distance', () => {
    const frame = buildRowingSummaryFrame({
      strokeRateSpm: 0,
      currentPaceTenthSeconds: 0,
      averagePaceTenthSeconds: 0,
      strokeCountCenti: 0,
      distanceMeters: 0,
    });
    const truncated = frame.slice(0, 30);

    expect(decodeRowingSummary(truncated)).toBeNull();
  });

  it('decodeNotification routes aa-95-25 frame to rowing_summary', () => {
    const frame = buildRowingSummaryFrame({
      strokeRateSpm: 24,
      currentPaceTenthSeconds: 1500,
      averagePaceTenthSeconds: 1500,
      strokeCountCenti: 100,
      distanceMeters: 50,
    });

    const result = decodeNotification(frame);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('rowing_summary');
    if (result?.type === 'rowing_summary') {
      expect(result.event.strokeRateSpm).toBe(24);
      expect(result.event.distanceMeters).toBe(50);
    }
  });
});

/**
 * Synthesize a rowing status frame (`aa 92`). Payload offset 11..14 holds
 * distance in centimeters (uint32 LE).
 */
function buildRowingStatusFrame(params: { strokeRateSpm: number; distanceCm: number }): Uint8Array {
  // Frame layout: 10 envelope + cmd byte (0xaa) + 15-byte payload (sub-type
  // 0x92 + 14 bytes carrying stroke rate + reserved + distance) + 2 CRC = 28.
  const frame = new Uint8Array(28);
  frame[0] = 0x55;
  frame[1] = 0x1c;
  frame[2] = 0x04;
  frame[3] = 0x00;
  frame[4] = 0x10;
  frame[5] = 0xaa;
  frame[10] = 0xaa;
  frame[11] = 0x92;
  // strokeRate at payload offset 2 = frame offset 13.
  frame[13] = params.strokeRateSpm & 0xff;
  // Distance cm at payload offsets 11..14 = frame offsets 22..25.
  writeUint32LE(frame, 22, params.distanceCm);
  return frame;
}

describe('decodeRowingStatus', () => {
  it('decodes distance from centimeters to meters', () => {
    const frame = buildRowingStatusFrame({ strokeRateSpm: 26, distanceCm: 12345 });

    const event = decodeRowingStatus(frame);

    expect(event).not.toBeNull();
    expect(event!.strokeRateSpm).toBe(26);
    expect(event!.distanceMeters).toBe(123.45);
  });

  it('decodes zero distance', () => {
    const frame = buildRowingStatusFrame({ strokeRateSpm: 0, distanceCm: 0 });

    const event = decodeRowingStatus(frame);

    expect(event!.distanceMeters).toBe(0);
  });

  it('returns null for a frame that is not aa-92', () => {
    const data = hexToBytes(FRAME_CMD10_DAMPER_LEVEL_7);

    expect(decodeRowingStatus(data)).toBeNull();
  });

  it('decodeNotification routes aa-92 frame to rowing_status', () => {
    const frame = buildRowingStatusFrame({ strokeRateSpm: 30, distanceCm: 100 });

    const result = decodeNotification(frame);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('rowing_status');
    if (result?.type === 'rowing_status') {
      expect(result.event.distanceMeters).toBe(1);
    }
  });
});

/**
 * Synthesize a waveform-chunk frame (`aa 93 <variant>`). Payload offsets
 * 1=variant, 2=chunkIndex, 4..5=declared sample count, 6+=samples.
 */
function buildWaveformChunkFrame(params: {
  variant: number;
  chunkIndex: number;
  samples: number[];
}): Uint8Array {
  const sampleBytes = params.samples.length * 2;
  // 10 envelope + cmd byte (0xaa) + sub-type byte (0x93) + 5-byte chunk
  // header (variant, chunkIndex, unknown, count_lo, count_hi) + samples
  // + 2 CRC.
  const frame = new Uint8Array(10 + 2 + 5 + sampleBytes + 2);
  frame[0] = 0x55;
  frame[1] = frame.length & 0xff;
  frame[2] = 0x04;
  frame[3] = 0x00;
  frame[4] = 0x10;
  frame[5] = 0xaa;
  frame[10] = 0xaa;
  frame[11] = 0x93;
  frame[12] = params.variant;
  frame[13] = params.chunkIndex;
  frame[14] = 0; // unknown / length hint
  frame[15] = params.samples.length & 0xff;
  frame[16] = (params.samples.length >>> 8) & 0xff;
  for (let i = 0; i < params.samples.length; i++) {
    frame[17 + i * 2] = params.samples[i] & 0xff;
    frame[17 + i * 2 + 1] = (params.samples[i] >>> 8) & 0xff;
  }
  return frame;
}

describe('decodeWaveformChunk', () => {
  it('decodes a CC-variant chunk (isometric marker)', () => {
    const frame = buildWaveformChunkFrame({
      variant: 0xcc,
      chunkIndex: 1,
      samples: [100, 200, 300, 400],
    });

    const event = decodeWaveformChunk(frame);

    expect(event).not.toBeNull();
    expect(event!.variant).toBe(0xcc);
    expect(event!.chunkIndex).toBe(1);
    expect(event!.declaredSampleCount).toBe(4);
    expect(Array.from(event!.samples)).toEqual([100, 200, 300, 400]);
    // Sample unit must NOT be 'newtons' — rowing samples are tenths-of-pounds.
    expect(event!.sampleUnit).toBe('tenths-of-pounds');
  });

  it('decodes a 0x82-variant chunk (rowing marker)', () => {
    const frame = buildWaveformChunkFrame({
      variant: 0x82,
      chunkIndex: 2,
      samples: [50, 75],
    });

    const event = decodeWaveformChunk(frame);

    expect(event).not.toBeNull();
    expect(event!.variant).toBe(0x82);
    expect(Array.from(event!.samples)).toEqual([50, 75]);
  });

  it('decodes a 0xA8-variant chunk (alternate marker)', () => {
    const frame = buildWaveformChunkFrame({
      variant: 0xa8,
      chunkIndex: 3,
      samples: [10],
    });

    const event = decodeWaveformChunk(frame);

    expect(event).not.toBeNull();
    expect(event!.variant).toBe(0xa8);
  });

  it('rejects unknown variant markers', () => {
    const frame = buildWaveformChunkFrame({
      variant: 0xee,
      chunkIndex: 1,
      samples: [1],
    });

    const event = decodeWaveformChunk(frame);

    expect(event).toBeNull();
  });

  it('handles a chunk where declared count > available samples', () => {
    const frame = buildWaveformChunkFrame({
      variant: 0xcc,
      chunkIndex: 1,
      samples: [100, 200],
    });
    // Mutate declared count to claim 10 samples — only 2 should be decoded.
    frame[15] = 10;
    frame[16] = 0;

    const event = decodeWaveformChunk(frame);

    expect(event).not.toBeNull();
    expect(event!.declaredSampleCount).toBe(10);
    // Only 2 samples actually fit in the buffer (modulo CRC trailer).
    expect(event!.samples.length).toBeLessThanOrEqual(2);
  });

  it('decodeNotification routes aa-93-cc to waveform_chunk', () => {
    const frame = buildWaveformChunkFrame({
      variant: 0xcc,
      chunkIndex: 1,
      samples: [123],
    });

    const result = decodeNotification(frame);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('waveform_chunk');
  });
});
