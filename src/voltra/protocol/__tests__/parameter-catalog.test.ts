/**
 * Phase 2.5 — generated ParameterCatalog smoke tests.
 *
 * The protocol data carries a structured catalog in
 * `protocol.telemetry.parameterCatalog`. This test pins:
 *   - the catalog is populated and non-empty (no regression in codegen)
 *   - every paramID below resolves to a catalog entry
 *   - the catalog and the hand-written width expectations AGREE for every
 *     paramID *except* the two known Phase 2.7 width disagreements (the
 *     training-mode and inverse-chains registers), which are pinned apart.
 */

import { describe, expect, it } from 'vitest';

import { ParamIdHex, ParameterCatalog } from '../constants';

/**
 * Value widths written out by hand, independent of the catalog, so this test
 * fails loudly if the generated widths move.
 */
const SDK_HAND_AUTHORED_WIDTHS: Readonly<Record<string, number>> = {
  [ParamIdHex.BASE_WEIGHT]: 2,
  [ParamIdHex.CHAINS]: 2,
  [ParamIdHex.ECCENTRIC]: 2,
  [ParamIdHex.BP_SET_FITNESS_MODE]: 2,
  '823e': 2,
  '6a50': 2,
  '6253': 2,
  b753: 2,
  '3154': 2,
  d253: 2,
  '6153': 1,
  b653: 1,
  e352: 1,
  '0651': 1,
  [ParamIdHex.INVERSE_CHAINS]: 1,
  c653: 1,
  [ParamIdHex.TRAINING_MODE]: 1,
  [ParamIdHex.DAMPER_LEVEL!]: 1,
};

/**
 * paramIDs whose catalog width disagrees with the SDK decoder. Resolution
 * deferred to Phase 2.7 pending on-device validation.
 */
const PHASE_2_7_WIDTH_DISAGREEMENTS = new Set<string>([
  ParamIdHex.TRAINING_MODE,
  ParamIdHex.INVERSE_CHAINS,
]);

describe('ParameterCatalog (Phase 2.5)', () => {
  it('is non-empty (regression: codegen emitted the catalog)', () => {
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
    expect(PHASE_2_7_WIDTH_DISAGREEMENTS.size).toBe(2);
    for (const wireLE of PHASE_2_7_WIDTH_DISAGREEMENTS) {
      expect(ParameterCatalog[wireLE]?.valueWidth).toBe(2);
      expect(SDK_HAND_AUTHORED_WIDTHS[wireLE]).toBe(1);
    }
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

  it('declares the eccentric register int16 (signed) in the catalog', () => {
    // Pin the signedness contract so future decoder migration knows it
    // must apply readInt16LE, not readUint16LE.
    const entry = ParameterCatalog[ParamIdHex.ECCENTRIC];
    expect(entry).toBeDefined();
    expect(entry.valueType).toBe('int16');
  });
});
