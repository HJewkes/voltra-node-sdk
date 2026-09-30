// The source-level confidentiality guard (VW-214), tested against SHAPES.
//
// Every fixture here is synthetic. Quoting a real capture would put it in the
// repo, which is what the guard exists to prevent.
//
// The rule is off for test paths (deferred to w5-14), so the fixtures below do
// not trip it on their way past. They are assembled from parts so that
// `npm run audit:privacy`, which does read test paths, never sees a keyword.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
// @ts-expect-error — the rule ships as plain ESM so `eslint.config.mjs` can load it.
import * as guard from '../../eslint-rules/no-private-provenance.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const findProvenance = guard.findProvenance as (text: string) => { index: number }[];
const findByteRuns = guard.findByteRuns as (text: string) => { index: number }[];
const isCommandCodeIdentifier = guard.isCommandCodeIdentifier as (name: string) => boolean;

const PRIVATE_REPO = ['voltra', 'private'].join('-');
const PRIVATE_PATH = `// Inlined from ${PRIVATE_REPO}/src/protocol/enums.ts.`;

describe('provenance', () => {
  it.each([
    ['a path into the private repo', PRIVATE_PATH],
    ['a capture session path', `// reproducer: ${'capture'}s/${'session'}s/2026-01-01`],
    ['a research document', `// see ${'research'}/rowing-notes.md`],
    ['a named validation phase', `// from the ${'validation'}-phase-7 session`],
    ['a vendor-app derivation', `// ${'de' + 'compil'}ed from the vendor application`],
    ['a trailing comment', `const q = 1; // see ${PRIVATE_REPO} notes`],
  ])('flags %s', (_label, text) => {
    expect(findProvenance(text).length).toBeGreaterThan(0);
  });

  it('exempts the sanctioned regeneration header, and only that line', () => {
    const header = `// @generated — do not edit. Regenerate: npm run build (from ${PRIVATE_REPO})`;
    expect(findProvenance(header)).toEqual([]);
    // The exclusion is the HEADER, not the FILE: anything below it still counts.
    expect(findProvenance(`${header}\n${PRIVATE_PATH}`).length).toBe(1);
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
    ['an underscored capture', ' observed a9_c7_00_04 on the wire'],
    ['an underscored capture behind a prefix', ' observed frame_a9_c7_00_04 on the wire'],
  ])('flags %s', (_label, text) => {
    expect(findByteRuns(text).length).toBeGreaterThan(0);
  });

  it.each([
    ['a short annotation', ' the value is 0x1f'],
    ['a timestamp', ' "[00:00:00.000 --> 00:00:01.100] stop"'],
    ['a date', ' bench 2026-07-07'],
    ['a snake_case identifier', ' see set_weight_lbs'],
  ])('lets %s through', (_label, text) => {
    expect(findByteRuns(text)).toEqual([]);
  });
});

// A template literal is a string with different quotes, and the sibling guard
// in voltras-mcp catches values in one. Without a `TemplateElement` visitor the
// two rules disagreed on the same shape, and the one that missed it guards the
// repo published to npm. This test is here so removing the visitor fails.
describe('the rule visitors', () => {
  const run = (code: string): unknown[] =>
    new Linter().verify(code, [
      {
        plugins: { voltras: guard.default as never },
        rules: { 'voltras/no-private-provenance': 'error' },
      },
    ]);

  it('flags a command code in a template literal', () => {
    expect(run('const probe = `cmd0x10`;')).toHaveLength(1);
  });

  it('flags a command code in an ordinary string literal', () => {
    expect(run("const probe = 'cmd0x10';")).toHaveLength(1);
  });

  it('leaves an executable protocol value alone', () => {
    expect(run('const LEGAL = 0xa9c700041b2c3d;')).toEqual([]);
  });
});

// VW-224. Every flagged token below is assembled at runtime, so no fixture in
// this block spells one.
describe('a value split across a concatenation or a separator (VW-224)', () => {
  const CMD = ['c', 'm', 'd'].join('');
  const CODE = ['1', '0'].join('');
  const REPO = ['vol', 'tra'].join('');
  const PRIVATE = ['pri', 'vate'].join('');

  const run = (code: string) =>
    new Linter()
      .verify(
        code,
        [
          {
            files: ['**/*.ts'],
            languageOptions: { parser: tseslint.parser },
            plugins: { voltras: guard.default as never },
            rules: { 'voltras/no-private-provenance': 'error' },
          },
        ],
        'probe.ts'
      )
      .map((m) => m.messageId);

  it.each([
    ['a command code split after its name', `const v = '${CMD}' + '${CODE}';`],
    ['a command code split out of a template', `const v = \`${CMD}\` + '${CODE}';`],
    ['a private path wrapped across three pieces', `const v = 'see ${REPO}' + '-' + '${PRIVATE}';`],
    ['a piece wrapped in `as`', `const v = ('${CMD}' as string) + '${CODE}';`],
    ['a piece wrapped in `satisfies`', `const v = ('${CMD}' satisfies string) + '${CODE}';`],
    ['a nested chain', `const v = 'x ' + ('${CMD}' + '${CODE}');`],
    ['a run of literals behind an identifier', `const v = label + ' ${CMD}' + '${CODE}';`],
    [
      'two split values in one chain',
      `const v = '${CMD}' + '${CODE}' + ' ${REPO}-' + '${PRIVATE}';`,
    ],
    ['a piece that is a hit, with more after the join', `const v = '${CMD}${CODE}' + 'ff';`],
    ['an escaped piece beside a harmless join', `const v = '${REPO}\\x2d${PRIVATE}' + ' notes';`],
    ['an escaped template', `const v = \`${REPO}\\x2d${PRIVATE}\`;`],
    ['a literal split by a line continuation', `const v = '${REPO}-\\\n${PRIVATE}';`],
    ['a sub-chain wrapped in `as`', `const v = '${REPO}-pri' + ('va' + 'te' as string);`],
    ['a sub-chain wrapped in `!`', `const v = '${REPO}-pri' + ('va' + 'te')!;`],
    [
      'a sub-chain wrapped in `satisfies`',
      `const v = ('${REPO}-' + 'pri' satisfies string) + 'vate';`,
    ],
    ['a template whose tail meets the join', `const v = \`\${x} ${REPO}-\` + '${PRIVATE}';`],
    ['a template whose head meets the join', `const v = '${REPO}-' + \`${PRIVATE} \${x}\`;`],
    [
      'a wrapped sub-chain that is itself a hit',
      `const v = 'x ' + ('${CMD}' + '${CODE}' as string);`,
    ],
  ])('reports %s once', (_label, code) => {
    expect(run(code)).toHaveLength(1);
  });

  it('reports a chain at its start', () => {
    const code = `const v = '${CMD}' + '${CODE}';`;
    const [message] = new Linter().verify(code, [
      {
        plugins: { voltras: guard.default as never },
        rules: { 'voltras/no-private-provenance': 'error' },
      },
    ]);
    expect(message.column).toBe(code.indexOf(`'${CMD}'`) + 1);
  });

  it.each([
    ['a snake_case name built in pieces', "const v = 'max_' + 'force_' + 'lbs';"],
    ['ordinary words', "const v = 'Set ' + 'complete' + ', rest ' + 'now';"],
    ['a word and a digit', "const v = 'add' + '1' + 'feed' + '2';"],
    ['a name joined to an identifier', `const v = '${CMD}' + digits;`],
    ['a name joined to a call', `const v = '${CMD}' + pad(value);`],
    ['numeric addition', 'const v = 1 + 2 + 3;'],
    ['snake_case identifiers', 'const max_force_lbs = 1; const cmd_ack_state = 2;'],
  ])('lets %s through', (_label, code) => {
    expect(run(code)).toEqual([]);
  });

  it.each([
    ['a provenance keyword spelled with underscores', `${REPO}_${PRIVATE}`],
    ['one spelled with doubled underscores', `${REPO}__${PRIVATE}`],
    ['a named phase spelled with an underscore', ['validation', 'phase'].join('_')],
  ])('flags %s', (_label, text) => {
    expect(findProvenance(text).length).toBeGreaterThan(0);
  });

  it.each([
    `${CMD.toUpperCase()}_0X_${CODE}`,
    `${CMD.toUpperCase()}__0X__${CODE}`,
    `${CMD}_id_${CODE}`,
    `${CMD}0x_${CODE}`,
  ])('flags the identifier %s, with the prefix as its own segment', (name) => {
    expect(isCommandCodeIdentifier(name)).toBe(true);
  });

  // These still slip; CONTRIBUTING.md lists them. A test that starts failing
  // here means the boundary text needs updating, not that something broke.
  it.each([
    ['a split around a variable', `const v = '${CMD}' + x + '${CODE}';`],
    ['Array join', `const v = ['${CMD}', '${CODE}'].join('');`],
    ['String concat', `const v = '${CMD}'.concat('${CODE}');`],
    ['+=', `let v = '${CMD}'; v += '${CODE}';`],
    ['a tagged template', `const v = String.raw\`${CMD}\` + '${CODE}';`],
    ['a number literal in the chain', `const v = '${CMD}_' + 0x${CODE};`],
    ['a template holding a literal', `const v = \`${CMD}\${'${CODE}'}\`;`],
    ['a conditional in the chain', `const v = (c ? '${CMD}' : 'x') + '${CODE}';`],
    ['String.fromCharCode', `const v = String.fromCharCode(99, 109, 100) + '${CODE}';`],
  ])('documents that %s is not caught', (_label, code) => {
    expect(run(code)).toEqual([]);
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
