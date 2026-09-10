// Source-level confidentiality guard for the published SDK (VW-214).
//
// This repo CANNOT ban protocol values, and a rule that pretended otherwise
// would be switched off within a week. Decoding the device is what the package
// does: `src/index.ts` exports the protocol constant barrels as supported
// public API, and the generated factories under `_factories/` regenerate from
// the private toolchain on every build. Values there ship by design.
//
// What has no legitimate place in published source is everything AROUND the
// values — where they came from, and captures reproduced verbatim. Three
// categories, and deliberately no fourth: if an exemption list ever grows
// longer than the rule, the line was drawn in the wrong place.
//
//   1. PROVENANCE. Private-repo paths, capture and research trees,
//      decompilation, named validation phases. Zero legitimate uses in
//      published source, so this is banned outright and scanned over the whole
//      file text — code, strings, doc tags and trailing comments alike.
//
//   2. COMMAND CODES INSIDE IDENTIFIERS. A symbol name is never load-bearing
//      the way a value is: nothing decodes worse for a symbol being named
//      after what it does rather than after its number.
//
//   3. VERBATIM BYTE RUNS IN COMMENTS. A long uninterrupted run of hex inside
//      a comment is a capture, not a value; the same run in an expression is a
//      value. POSITION is what separates them, which is why comments are read
//      from the AST rather than guessed at with a regex. A short run in a
//      comment stays legal — annotating a constant is normal work here.
//
// Generated files are outside this rule because ESLint ignores them repo-wide.
// They are covered instead by `scripts/audit-privacy.sh`, which reads them as
// text and excludes only the sanctioned regeneration header.
//
// WHAT THIS RULE CANNOT SEE, named rather than left to be discovered:
//
//   - A value SPLIT ACROSS A CONCATENATION. `'cmd' + '0x10'` is two string
//     literals to the parser and neither half is a finding alone. Constant
//     folding would close it and is not worth the machinery: deliberate
//     evasion is not the threat model, because anyone evading would simply not
//     write the value. What does happen is a long string wrapped to fit the
//     line width, so keep a value on one line where the rule can see it.
//   - PROVENANCE PHRASED ORGANICALLY. A sentence saying where a number came
//     from, carrying no path and no keyword, matches nothing here. That is out
//     of scope by ruling rather than by oversight: this rule catches encoded
//     values and named references, and prose is a review-checklist item. See
//     CONTRIBUTING.md.
//
// Naming both is the point. A guard that is silently narrower than it looks is
// the failure this campaign is named after (VW-220).
//
// Messages name the shape and never the token. A CI log is as public as the
// source it refused.

const PROVENANCE =
  /voltra-private|\bcaptures?\/|\bresearch\/|decompil|reverse[- ]engineer|validation-phase/gi;

/**
 * The one sanctioned line, excluded by SHAPE and only on the line it occupies.
 * Generated files that live outside `*.generated.ts` still carry the header,
 * and it is the one place the private toolchain may be named: a contributor
 * who edits generated output needs to be told where to edit instead.
 *
 * The exclusion is the HEADER, never the file. Excluding a generated file
 * wholesale would hide any provenance written below the header behind the
 * header's own legitimacy.
 */
const REGEN_HEADER = /\/\/ @generated [^\n]*Regenerate:[^\n]*/g;

/**
 * Two shapes that were considered and deliberately left out, because in THIS
 * repo they are ordinary:
 *
 *   - `phase-<n>`. The SDK numbers its own refactor phases and the string
 *     `pre-Phase-0` appears across the manager and the adapters. A research
 *     phase is only identifiable by the private tree around it, and that tree
 *     is already banned above.
 *   - A device name beginning with the vendor prefix. That prefix is public
 *     API — `connectByName` is documented with it in four separate examples —
 *     and no shape separates a documentation placeholder from a real unit's
 *     serial. Serials are a REVIEW-CHECKLIST item, not a lint rule; see
 *     CONTRIBUTING.md.
 */

/**
 * A command code welded into a symbol name, matched by SEGMENT rather than by
 * a word boundary. `parseCmd10` has no word boundary before `Cmd` and
 * `CMD_0X10_LATCH` has none after `10`, so an anchored pattern misses both —
 * which is exactly how a spelling-shaped rule passes a tree it does not cover.
 *
 * The code half must carry a digit, which is what keeps `cmdAck` and `cmdFace`
 * out: both end in runs made only of hex letters, and neither is a number.
 */
const SEGMENT_BOUNDARY = /[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Z0-9])(?=[A-Z][a-z])/;
const CMD_SEGMENT = /^cmd(?:id)?$/i;
const CMD_WITH_CODE = /^cmd(?:id)?(?:0x)?[0-9a-f]{2,}$/i;
const CODE_SEGMENT = /^(?:id)?(?:0x)?[0-9a-f]{2,}$/i;
const HAS_DIGIT = /\d/;

/** Four or more bytes reproduced verbatim, run together or separated. */
const BYTE_RUN = /(?<![\w#])(?:[0-9a-f]{8,}|[0-9a-f]{2}(?:[ ,:-][0-9a-f]{2}){3,})(?![\w-])/gi;

/**
 * The same capture spelled with `_`. Underscore is an identifier separator
 * rather than punctuation, so this spelling is found by segmenting words
 * rather than by widening the class above — which is what reaches
 * `frame_a9_c7_00_04` as well as `a9_c7_00_04`. Widening the class reaches
 * only the second, because a prefixed run no longer starts at a word boundary.
 */
const WORD = /[A-Za-z0-9_$]+/g;
const HEX_PAIR = /^[0-9a-f]{2}$/i;
const BYTES_IN_A_CAPTURE = 4;

/** A clock or a date, which is not a capture whatever its separators. */
const CLOCK_SHAPE = /^\d{2}(?:[:.]\d{2})+$/;

/** Every finding in `text`, as `{ kind, index, length }`. */
export function findProvenance(text) {
  const sanctioned = [...text.matchAll(REGEN_HEADER)].map((m) => [m.index, m.index + m[0].length]);
  return [...text.matchAll(PROVENANCE)]
    .filter((m) => !sanctioned.some(([from, to]) => m.index >= from && m.index < to))
    .map((m) => ({ kind: 'provenance', index: m.index, length: m[0].length }));
}

/** Every verbatim byte run in `text`, as `{ index, length }`. */
export function findByteRuns(text) {
  const runs = [...text.matchAll(BYTE_RUN)]
    .filter((m) => !CLOCK_SHAPE.test(m[0]))
    .map((m) => ({ index: m.index, length: m[0].length }));
  for (const match of text.matchAll(WORD)) {
    let pairRun = 0;
    for (const segment of match[0].split(SEGMENT_BOUNDARY).filter(Boolean)) {
      pairRun = HEX_PAIR.test(segment) ? pairRun + 1 : 0;
      if (pairRun === BYTES_IN_A_CAPTURE) {
        runs.push({ index: match.index, length: match[0].length });
        break;
      }
    }
  }
  return runs.sort((a, b) => a.index - b.index);
}

/** Whether `name` carries a command code, in any spelling. */
export function isCommandCodeIdentifier(name) {
  const segments = name.split(SEGMENT_BOUNDARY).filter(Boolean);
  return segments.some((segment, i) => {
    if (CMD_WITH_CODE.test(segment) && HAS_DIGIT.test(segment)) return true;
    if (!CMD_SEGMENT.test(segment)) return false;
    const next = segments[i + 1];
    return next !== undefined && CODE_SEGMENT.test(next) && HAS_DIGIT.test(next);
  });
}

const MESSAGES = {
  provenance:
    'This states where a protocol fact came from, which may not appear in published source (VW-214). Keep derivation, captures and research pointers in the private repo.',
  identifier:
    'This symbol name carries a command code (VW-214). Name it after what it does; the value belongs in the generated protocol data.',
  byteRun:
    'This comment reproduces a capture verbatim (VW-214). Describe what the bytes mean; keep the capture in the private repo.',
};

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban provenance, command-code identifiers and verbatim captures from the published SDK source (VW-214).',
    },
    schema: [],
    messages: MESSAGES,
  },
  create(context) {
    const source = context.sourceCode;
    const report = (index, length, messageId) =>
      context.report({
        loc: {
          start: source.getLocFromIndex(index),
          end: source.getLocFromIndex(index + length),
        },
        messageId,
      });

    return {
      Program() {
        for (const { index, length } of findProvenance(source.getText())) {
          report(index, length, 'provenance');
        }
        for (const comment of source.getAllComments()) {
          for (const { index, length } of findByteRuns(comment.value)) {
            report(comment.range[0] + 2 + index, length, 'byteRun');
          }
        }
      },
      Identifier(node) {
        if (isCommandCodeIdentifier(node.name))
          report(node.range[0], node.name.length, 'identifier');
      },
      Literal(node) {
        if (typeof node.value === 'string' && isCommandCodeIdentifier(node.value)) {
          report(node.range[0], node.raw.length, 'identifier');
        }
      },
      // A template literal is a string with different quotes. Without this the
      // two guards in this campaign disagreed on the same shape, and the one
      // that missed it guarded the repo that is actually published.
      TemplateElement(node) {
        if (isCommandCodeIdentifier(node.value.raw)) {
          report(node.range[0], node.value.raw.length, 'identifier');
        }
      },
    };
  },
};

export default { rules: { 'no-private-provenance': rule } };
