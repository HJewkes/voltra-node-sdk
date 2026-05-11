/**
 * Phase 2.5 — generated ParameterCatalog smoke tests.
 *
 * voltra-private's `parameters/` registry now emits a structured catalog
 * into the SDK via `protocol.telemetry.parameterCatalog`. This test pins:
 *   - the catalog is populated and non-empty (no regression in codegen)
 *   - every wireLE the decoder's `CMD_0F_KNOWN_PARAM_WIDTHS` lookup
 *     references resolves to a catalog entry (so future migrations have a
 *     1:1 source of truth)
 *   - the catalog and the hand-authored width table AGREE for every
 *     paramID *except* the two known Phase 2.7 width disagreements
 *     (`b04f` FITNESS_WORKOUT_STATE, `b053` FITNESS_INVERSE_CHAIN). Those
 *     two are explicitly excluded and tracked separately.
 */

import { describe, expect, it } from 'vitest';

import { ParameterCatalog } from '../constants';

/**
 * paramID widths the SDK decoder treats authoritatively today, copied from
 * `telemetry-decoder.ts:CMD_0F_KNOWN_PARAM_WIDTHS`. Kept here so this test
 * fails loudly if either side mutates without the other being updated.
 */
const SDK_HAND_AUTHORED_WIDTHS: Readonly<Record<string, number>> = {
  '863e': 2, // BP_BASE_WEIGHT
  '873e': 2, // BP_CHAINS_WEIGHT
  '883e': 2, // BP_ECCENTRIC_WEIGHT (signed)
  '893e': 2, // BP_SET_FITNESS_MODE
  '823e': 2, // BP_RUNTIME_POSITION_CM
  '6a50': 2, // MC_DEFAULT_OFFLEN_CM
  '6253': 2, // RESISTANCE_BAND_MAX_FORCE
  b753: 2, // RESISTANCE_BAND_LEN
  '3154': 2, // ISOMETRIC_MAX_FORCE
  d253: 2, // ISOMETRIC_MAX_DURATION
  '6153': 1, // RESISTANCE_BAND_ALGORITHM
  b653: 1, // RESISTANCE_BAND_LEN_BY_ROM
  e352: 1, // EP_RESISTANCE_BAND_INVERSE
  '0651': 1, // FITNESS_ASSIST_MODE
  b053: 1, // FITNESS_INVERSE_CHAIN — Phase 2.7 disagreement (vp = uint16/2)
  c653: 1, // WEIGHT_TRAINING_EXTRA_MODE
  b04f: 1, // FITNESS_WORKOUT_STATE — Phase 2.7 disagreement (vp = uint16/2)
  '0351': 1, // FITNESS_DAMPER_RATIO_IDX
};

/**
 * paramIDs with documented width disagreements between voltra-private's
 * registry and the SDK decoder. Resolution deferred to Phase 2.7 pending
 * on-device validation. Listed in `voltra-private/src/protocol/parameters/
 * fitness/workout-state.ts` and `inverse-chain.ts` docblocks.
 */
const PHASE_2_7_WIDTH_DISAGREEMENTS = new Set([
  'b04f', // FITNESS_WORKOUT_STATE: vp=2, sdk=1
  'b053', // FITNESS_INVERSE_CHAIN: vp=2, sdk=1
]);

describe('ParameterCatalog (Phase 2.5)', () => {
  it('is non-empty (regression: vp Phase 2.5 codegen emitted the catalog)', () => {
    expect(Object.keys(ParameterCatalog).length).toBeGreaterThan(0);
  });

  it('covers every wireLE the SDK decoder hand-authors a width for', () => {
    for (const wireLE of Object.keys(SDK_HAND_AUTHORED_WIDTHS)) {
      expect(ParameterCatalog[wireLE]).toBeDefined();
    }
  });

  it('catalog widths match the SDK hand-authored widths (except documented Phase 2.7 disagreements)', () => {
    for (const [wireLE, sdkWidth] of Object.entries(SDK_HAND_AUTHORED_WIDTHS)) {
      if (PHASE_2_7_WIDTH_DISAGREEMENTS.has(wireLE)) continue;
      const entry = ParameterCatalog[wireLE];
      expect(entry.valueWidth).toBe(sdkWidth);
    }
  });

  it('Phase 2.7 width disagreements are preserved as catalog uint16 / SDK uint8', () => {
    // Sanity-pin the disagreement so resolution work in Phase 2.7 knows
    // exactly what it's reconciling.
    expect(ParameterCatalog['b04f']?.valueWidth).toBe(2);
    expect(SDK_HAND_AUTHORED_WIDTHS['b04f']).toBe(1);
    expect(ParameterCatalog['b053']?.valueWidth).toBe(2);
    expect(SDK_HAND_AUTHORED_WIDTHS['b053']).toBe(1);
  });

  it('every entry carries paramId / name / wireBE / wireLE / valueType / valueWidth metadata', () => {
    for (const [wireLE, entry] of Object.entries(ParameterCatalog)) {
      expect(typeof entry.paramId).toBe('number');
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.wireBE).toBe('string');
      expect(entry.wireLE).toBe(wireLE);
      expect(['uint8', 'uint16', 'int16', 'uint32', 'int32']).toContain(entry.valueType);
      expect([1, 2, 4]).toContain(entry.valueWidth);
    }
  });

  it('BP_ECCENTRIC_WEIGHT (0x883e) is declared int16 (signed) in the catalog', () => {
    // Pin the signedness contract so future decoder migration knows it
    // must apply readInt16LE, not readUint16LE.
    const entry = ParameterCatalog['883e'];
    expect(entry).toBeDefined();
    expect(entry.name).toBe('BP_ECCENTRIC_WEIGHT');
    expect(entry.valueType).toBe('int16');
  });
});
