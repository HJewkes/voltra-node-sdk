/**
 * Bundler-opacity contract for the platform adapter loads (VW-101).
 *
 * `voltra-manager.ts` is the one file that reaches every platform backend.
 * Bundlers resolve a module reference by constant-folding its specifier and
 * pull the target in regardless of whether its branch can execute, so a
 * literal `require('../bluetooth/adapters/node-noble')` here drags
 * `@stoprocent/noble` -> `node:os` into a React Native bundle and the build
 * fails outright with "Unable to resolve module os".
 *
 * These tests fail if a statically-analyzable reference to a Node-only
 * adapter is reintroduced. They read the source rather than the build
 * output because the source is where the regression happens and because
 * `tsc` emits these calls verbatim.
 *
 * Companion to `src/entries/__tests__/web.test.ts`, which pins the same
 * property for the browser entry from the export side.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MANAGER_SOURCE = readFileSync(
  fileURLToPath(new URL('../voltra-manager.ts', import.meta.url)),
  'utf8'
);

/**
 * Adapters that carry dependencies a React Native bundle cannot resolve.
 * `node` -> `webbluetooth`; `node-noble` -> `@stoprocent/noble` -> `node:os`.
 */
const NODE_ONLY_ADAPTERS = ['../bluetooth/adapters/node', '../bluetooth/adapters/node-noble'];

/**
 * Adapters that are safe to reference by literal. `native` MUST stay
 * literal: it is the branch React Native executes, and Metro compiles an
 * unresolvable `require()` into a runtime throw.
 */
const BUNDLER_SAFE_ADAPTERS = ['../bluetooth/adapters/native', '../bluetooth/adapters/web'];

/**
 * Every `require('…')` / `import('…')` in the file whose specifier is a
 * plain string literal — i.e. exactly what a bundler can resolve.
 */
function staticallyAnalyzableSpecifiers(source: string): string[] {
  const pattern = /\b(?:require|import)\(\s*(['"])(.*?)\1\s*\)/g;
  return [...source.matchAll(pattern)].map((match) => match[2]);
}

describe('platform adapter load opacity', () => {
  it('references no Node-only adapter by a literal specifier', () => {
    const literals = staticallyAnalyzableSpecifiers(MANAGER_SOURCE);

    expect(literals.filter((specifier) => NODE_ONLY_ADAPTERS.includes(specifier))).toEqual([]);
  });

  it('only references bundler-safe adapters by literal specifier', () => {
    const adapterLiterals = staticallyAnalyzableSpecifiers(MANAGER_SOURCE).filter((specifier) =>
      specifier.includes('/adapters/')
    );

    expect([...new Set(adapterLiterals)].sort()).toEqual(BUNDLER_SAFE_ADAPTERS);
  });

  /**
   * Guards the guard: a specifier extractor that silently matches nothing
   * would make both assertions above unfailable.
   */
  it('extracts the literal specifiers it is asserting on', () => {
    const literals = staticallyAnalyzableSpecifiers(MANAGER_SOURCE);

    expect(literals).toContain('../bluetooth/adapters/native');
    expect(staticallyAnalyzableSpecifiers('require(\'x\'); await import("y");')).toEqual([
      'x',
      'y',
    ]);
  });

  /**
   * The Node-only specifiers still have to exist somewhere, or the adapters
   * could never load at runtime — they just have to be unfoldable.
   */
  it('keeps the Node-only specifiers behind a parameter-keyed lookup', () => {
    for (const specifier of NODE_ONLY_ADAPTERS) {
      expect(MANAGER_SOURCE).toContain(specifier);
    }

    expect(MANAGER_SOURCE).toMatch(/require\(specifier\)/);
  });

  /**
   * The trap this whole change turns on: Metro resolves the specifier with
   * Babel's `path.evaluate()`, which constant-folds
   * `const p = '…'; require(p)` just as readily as a string literal
   * (measured against Metro 0.84's `collectDependencies`). So the naive
   * indirection is not a fix, and the literal-specifier tests above cannot
   * see it — a folded local reads as no literal `require` at all.
   *
   * Pin the only two places a Node-only specifier may be written: the
   * erased `import type`, and the lookup table itself.
   */
  it('writes the Node-only specifiers nowhere a bundler could fold them', () => {
    const isTableEntry = /^\s*'?[\w-]+'?:\s*'[^']+',$/;
    const isErasedTypeImport = /^import type .*/;

    const loose = MANAGER_SOURCE.split('\n').filter(
      (line) =>
        NODE_ONLY_ADAPTERS.some((specifier) => line.includes(`'${specifier}'`)) &&
        !isTableEntry.test(line) &&
        !isErasedTypeImport.test(line)
    );

    expect(loose).toEqual([]);
  });
});
