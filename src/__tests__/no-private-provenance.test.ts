// The source-level confidentiality guard (VW-214), tested against SHAPES.
//
// Every fixture here is synthetic. Quoting a real capture would put it in the
// repo, which is what the guard exists to prevent.
//
// The rule is off for test paths (deferred to w5-14), so the fixtures below do
// not trip it on their way past.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
// @ts-expect-error — the rule ships as plain ESM so `eslint.config.mjs` can load it.
import * as guard from '../../eslint-rules/no-private-provenance.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const findProvenance = guard.findProvenance as (text: string) => { index: number }[];
const findByteRuns = guard.findByteRuns as (text: string) => { index: number }[];
const isCommandCodeIdentifier = guard.isCommandCodeIdentifier as (name: string) => boolean;

describe('provenance', () => {
  it.each([
    ['a path into the private repo', '// Inlined from voltra-private/src/protocol/enums.ts.'],
    ['a capture session path', '// reproducer: captures/sessions/2026-01-01'],
    ['a research document', '// see research/rowing-notes.md'],
    ['a named validation phase', '// from the validation-phase-7 session'],
    ['decompilation', '// decompiled from the vendor application'],
    ['a trailing comment', 'const q = 1; // see voltra-private notes'],
  ])('flags %s', (_label, text) => {
    expect(findProvenance(text).length).toBeGreaterThan(0);
  });

  it('exempts the sanctioned regeneration header, and only that line', () => {
    const header = '// @generated — do not edit. Regenerate: npm run build (from voltra-private)';
    expect(findProvenance(header)).toEqual([]);
    // The exclusion is the HEADER, not the FILE: anything below it still counts.
    expect(
      findProvenance(`${header}\n// Inlined from voltra-private/src/protocol/enums.ts.`).length
    ).toBe(1);
  });
});

describe('command codes in symbol names', () => {
  // `parseCmd10` has no word boundary before the code and `CMD_0X10_LATCH` has
  // none after it. A pattern anchored on `\b` misses both, which is exactly how
  // a sweep returns zero for a tree it does not cover.
  it.each(['cmd07', 'Cmd10', 'parseCmd10', 'CMD_0X10_LATCH', 'cmdID10', 'cmd0x10'])(
    'flags %s',
    (name) => {
      expect(isCommandCodeIdentifier(name)).toBe(true);
    }
  );

  it.each(['cmdBase', 'cmdAck', 'cmdData', 'cmdFace', 'cmdIdle', 'command', 'handleCommand'])(
    'lets %s through',
    (name) => {
      expect(isCommandCodeIdentifier(name)).toBe(false);
    }
  );
});

describe('verbatim captures in comments', () => {
  it.each([
    ['a run-together capture', ' observed a9c700041b2c3d on the wire'],
    ['a spaced capture', ' observed a9 c7 00 04 1b on the wire'],
    ['a hyphenated capture', ' observed a9-c7-00-04-1b on the wire'],
  ])('flags %s', (_label, text) => {
    expect(findByteRuns(text).length).toBeGreaterThan(0);
  });

  it.each([
    ['a short annotation', ' the value is 0x1f'],
    ['a timestamp', ' "[00:00:00.000 --> 00:00:01.100] stop"'],
    ['a date', ' bench 2026-07-07'],
  ])('lets %s through', (_label, text) => {
    expect(findByteRuns(text)).toEqual([]);
  });
});

describe('the exemption list', () => {
  // An exclusion that governs FIXING must never govern COUNTING. Every
  // exemption in the tree is enumerated here rather than trusted, so a new one
  // cannot appear without someone editing this list and saying why.
  const DIRECTIVE =
    /eslint-disable(?:-next-line|-line)?\s+voltras\/no-private-provenance\s+--\s+([^\n]*)/g;
  const REASON =
    'exported `MessageType` member; renaming it is a breaking API change (VW-214, see CONTRIBUTING.md)';

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) sourceFiles(path, out);
      else if (path.endsWith('.ts')) out.push(path);
    }
    return out;
  }

  it('is exactly the two published message-type members', () => {
    const sites: string[] = [];
    for (const file of sourceFiles(join(REPO_ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(DIRECTIVE)) {
        sites.push(`${relative(REPO_ROOT, file)} — ${match[1].trim()}`);
      }
    }
    expect(sites).toEqual(
      Array.from({ length: 6 }, () => `src/voltra/protocol/telemetry-decoder.ts — ${REASON}`)
    );
  });
});
