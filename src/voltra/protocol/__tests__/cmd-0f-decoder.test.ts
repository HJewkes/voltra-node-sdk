/**
 * cmd=0x0F bulk-read response decoder tests (Bug 17).
 *
 * Verifies the decoder accepts well-formed device-originated cmd=0x0F frames
 * (response to bootstrap step 10 + similar multi-paramID reads), extracts the
 * curated DeviceSettings subset (baseWeight / chains / eccentric /
 * trainingMode / inverseChains / damperLevel), and stops gracefully on
 * params whose value width is not in the SDK's known-widths table.
 */

import { describe, it, expect } from 'vitest';
import {
  decodeCmd0x0FResponse,
  decodeNotification,
  identifyMessageType,
} from '../telemetry-decoder';
import { ParamIdHex, TrainingMode } from '../constants';

const FRAME_TYPE_RESPONSE = 0x08;
const CMD_PARAM_READ = 0x0f;

/**
 * Build a synthetic cmd=0x0F response frame.
 *
 * Frame layout: `55 LEN 08 CRC8 SENDER RECEIVER SEQ_LO SEQ_HI 20 00 0F 00 COUNT_LO COUNT_HI ...PAYLOAD CRC16_LO CRC16_HI`.
 * The synthetic frame uses dummy CRC bytes — the decoder does not validate
 * CRCs, only structure + paramId widths.
 */
function buildCmd0x0FFrame(
  params: Array<{ paramIdHex: string; valueBytes: number[] }>
): Uint8Array {
  const headerBytes = [
    0x55, // magic
    0x00, // length placeholder, filled below
    FRAME_TYPE_RESPONSE,
    0x00, // crc8 (synthetic)
    0x10, // sender (device)
    0xaa, // receiver (app)
    0x06,
    0x00, // sequence (step-10 default)
    0x20,
    0x00, // proto
    CMD_PARAM_READ, // cmd=0x0F
    0x00, // result/status placeholder
    params.length & 0xff,
    (params.length >> 8) & 0xff,
  ];

  const paramBytes: number[] = [];
  for (const p of params) {
    // paramId is already LE in `paramIdHex`
    paramBytes.push(parseInt(p.paramIdHex.slice(0, 2), 16));
    paramBytes.push(parseInt(p.paramIdHex.slice(2, 4), 16));
    paramBytes.push(...p.valueBytes);
  }
  const crcBytes = [0x00, 0x00]; // synthetic CRC16

  const all = [...headerBytes, ...paramBytes, ...crcBytes];
  // length byte = total bytes minus the magic byte
  all[1] = all.length - 1;
  return new Uint8Array(all);
}

describe('decodeCmd0x0FResponse', () => {
  it('returns null for non-response frame types', () => {
    // App-write frame type 0x04 is not a response — should not match.
    const data = new Uint8Array([
      0x55,
      0x10,
      0x04,
      0x00,
      0xaa,
      0x10,
      0x00,
      0x00,
      0x20,
      0x00,
      CMD_PARAM_READ,
      0x00,
      0x01,
      0x00,
    ]);
    expect(decodeCmd0x0FResponse(data)).toBeNull();
  });

  it('returns null for non-0x0F cmd byte', () => {
    const data = new Uint8Array([
      0x55,
      0x10,
      FRAME_TYPE_RESPONSE,
      0x00,
      0x10,
      0xaa,
      0x00,
      0x00,
      0x20,
      0x00,
      0x10,
      0x00,
      0x01,
      0x00,
    ]);
    expect(decodeCmd0x0FResponse(data)).toBeNull();
  });

  it('returns null for buffers shorter than the frame header', () => {
    const data = new Uint8Array([0x55, 0x05, FRAME_TYPE_RESPONSE]);
    expect(decodeCmd0x0FResponse(data)).toBeNull();
  });

  it('decodes baseWeight (uint16) from a single-param response', () => {
    const data = buildCmd0x0FFrame([{ paramIdHex: ParamIdHex.BASE_WEIGHT, valueBytes: [75, 0] }]);
    const result = decodeCmd0x0FResponse(data);
    expect(result).not.toBeNull();
    expect(result!.paramCount).toBe(1);
    expect(result!.settings.baseWeight).toBe(75);
  });

  it('decodes the curated DeviceSettings subset from a multi-param response', () => {
    const data = buildCmd0x0FFrame([
      { paramIdHex: ParamIdHex.BASE_WEIGHT, valueBytes: [100, 0] },
      { paramIdHex: ParamIdHex.CHAINS, valueBytes: [20, 0] },
      { paramIdHex: ParamIdHex.ECCENTRIC, valueBytes: [50, 0] },
      // 0xb04f = trainingMode (uint8): WeightTraining
      { paramIdHex: ParamIdHex.TRAINING_MODE, valueBytes: [TrainingMode.WeightTraining] },
      // 0xb053 = inverseChains (uint8)
      { paramIdHex: ParamIdHex.INVERSE_CHAINS, valueBytes: [15] },
      // damperLevel (uint8): wire byte order [0x03, 0x51] -> hex '0351'
      // (paramID hex string corrected per B4 — was inverted '5103')
      { paramIdHex: '0351', valueBytes: [3] },
    ]);
    const result = decodeCmd0x0FResponse(data);
    expect(result).not.toBeNull();
    expect(result!.paramCount).toBe(6);
    expect(result!.settings).toEqual({
      baseWeight: 100,
      chains: 20,
      eccentric: 50,
      trainingMode: TrainingMode.WeightTraining,
      inverseChains: 15,
      damperLevel: 3,
    });
  });

  it('treats BP_ECCENTRIC_WEIGHT (paramId 0x3e88) as a signed int16', () => {
    // -50 as int16 LE = 0xCE 0xFF
    const data = buildCmd0x0FFrame([
      { paramIdHex: ParamIdHex.ECCENTRIC, valueBytes: [0xce, 0xff] },
    ]);
    const result = decodeCmd0x0FResponse(data);
    expect(result!.settings.eccentric).toBe(-50);
  });

  it('decodes step-10 paramIds with their documented widths', () => {
    // RESISTANCE_BAND_MAX_FORCE 0x5362 (LE 6253): uint16 = 100 lb
    // FITNESS_ASSIST_MODE      0x5106 (LE 0651): uint8  = 8 (off, asymmetric)
    // BP_RUNTIME_POSITION_CM   0x3e82 (LE 823e): uint16 = 130 cm
    // FITNESS_WORKOUT_STATE    0x4FB0 (LE b04f): uint8  = 4 (Damper)
    const data = buildCmd0x0FFrame([
      { paramIdHex: '6253', valueBytes: [100, 0] },
      { paramIdHex: '0651', valueBytes: [8] },
      { paramIdHex: '823e', valueBytes: [130, 0] },
      { paramIdHex: 'b04f', valueBytes: [TrainingMode.Damper] },
    ]);
    const result = decodeCmd0x0FResponse(data);
    expect(result!.paramCount).toBe(4);
    // The curated DeviceSettings only surfaces trainingMode out of these 4;
    // the other three are decoded for offset advancement but not surfaced.
    expect(result!.settings.trainingMode).toBe(TrainingMode.Damper);
  });

  it('aborts decoding on first paramId with unknown width (avoids mis-alignment)', () => {
    // QUICK_CABLE_ADJUSTMENT 0x54bc (LE bc54) — width unknown to the SDK.
    // Anything after it must be ignored to avoid mis-parsing subsequent
    // bytes against the wrong field positions.
    const data = buildCmd0x0FFrame([
      { paramIdHex: ParamIdHex.BASE_WEIGHT, valueBytes: [42, 0] },
      // unknown paramId aborts the loop
      { paramIdHex: 'bc54', valueBytes: [0xff, 0xff, 0xff, 0xff] },
      // these would parse but should not be reached
      { paramIdHex: ParamIdHex.CHAINS, valueBytes: [99, 0] },
    ]);
    const result = decodeCmd0x0FResponse(data);
    expect(result!.settings.baseWeight).toBe(42);
    expect(result!.settings.chains).toBeUndefined();
    expect(result!.paramCount).toBe(1);
  });

  it('drops invalid trainingMode values (per VALID_TRAINING_MODES guard)', () => {
    const data = buildCmd0x0FFrame([{ paramIdHex: ParamIdHex.TRAINING_MODE, valueBytes: [99] }]);
    const result = decodeCmd0x0FResponse(data);
    expect(result!.settings.trainingMode).toBeUndefined();
  });
});

describe('identifyMessageType / decodeNotification — cmd=0x0F integration', () => {
  it('classifies a cmd=0x0F response as `cmd_0f_bulk_response`', () => {
    const data = buildCmd0x0FFrame([{ paramIdHex: ParamIdHex.BASE_WEIGHT, valueBytes: [60, 0] }]);
    expect(identifyMessageType(data)).toBe('cmd_0f_bulk_response');
  });

  it('routes cmd=0x0F responses through the settings_update DecodeResult path', () => {
    // The dispatch funnels cmd=0x0F into the same `settings_update` shape so
    // existing onSettingsUpdate listeners (and syncSettingsFromDevice) see
    // bulk responses without needing a new event.
    const data = buildCmd0x0FFrame([
      { paramIdHex: ParamIdHex.BASE_WEIGHT, valueBytes: [80, 0] },
      { paramIdHex: ParamIdHex.TRAINING_MODE, valueBytes: [TrainingMode.Damper] },
    ]);
    const result = decodeNotification(data);
    expect(result?.type).toBe('settings_update');
    if (result?.type === 'settings_update') {
      expect(result.settings.baseWeight).toBe(80);
      expect(result.settings.trainingMode).toBe(TrainingMode.Damper);
    }
  });
});
