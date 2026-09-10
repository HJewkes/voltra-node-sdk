#!/usr/bin/env bash
# Privacy audit for the Voltra Node SDK (VW-214, VW-216).
#
# Companion to the `voltras/no-private-provenance` ESLint rule. That rule reads
# the AST of `src/**/*.ts`; this reads every file git tracks as text, which is
# how it covers the generated factories ESLint ignores plus the markdown,
# workflow and configuration files no linter looks at.
#
# WHAT THIS REPO DELIBERATELY ALLOWS, because a rule that pretended otherwise
# would be switched off within a week: protocol VALUES in executable code.
# Decoding the device is what this package does — `src/index.ts` exports the
# protocol constant barrels as supported public API, and the generated
# factories ship values by design. See CONTRIBUTING.md.
#
# WHAT IT DOES NOT ALLOW is everything around the values: where they came from,
# and captures reproduced verbatim in prose.
#
# Two rules about how this script is written, both learned the hard way:
#
#   - Every file is read as TEXT. A source file carrying a NUL byte is
#     classified binary and skipped SILENTLY by grep's default, and a file no
#     sweep can read looks exactly like a clean one. That happened in the
#     sibling repo and hid three findings for months.
#   - No spelling of a protocol value appears here. This script is as public as
#     the source it audits and its output lands in a public build log, so the
#     checks are written against shapes.
#
# Usage: npm run audit:privacy

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

failed=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; failed=1; }
note() { echo "  NOTE  $1"; }

# The sanctioned regeneration header, and nothing else. Generated output has to
# tell a contributor where to edit instead, so this one line may name the
# private toolchain. The exclusion covers the HEADER, never the FILE: excluding
# a generated file wholesale would hide anything written below the header
# behind the header's own legitimacy, which is what the previous version of
# this script did — for one of the five generated files, leaving the other four
# unexamined in both directions.
SANCTIONED_HEADER='// @generated .*Regenerate:'

# One matched FORM that a given check accepts, set immediately before that
# check and reset immediately after, so it can never leak into another sweep.
# Compared against the match, never the line.
SANCTIONED='__no_sanctioned_form__'

# Test trees still hold captures and citations from before this audit ran
# anywhere. Converting them to synthetic fixtures is tracked separately
# (w5-14). They are COUNTED and reported on every run and they do not fail the
# build: an exclusion that governs what gets FIXED must never govern what gets
# COUNTED.
TEST_PATH='(^|/)(__tests__|test)/|\.test\.'

# Where the rule is DEFINED and WRITTEN DOWN, as opposed to applied. A pattern
# definition is not a citation, and a document that states what may not appear
# has to name the things that may not appear. Any pattern-based guard has this
# property; the ESLint rule has it too, and gets it for free by living outside
# the tree it lints.
#
# This is an exemption about where a rule is written, never about content, and
# it covers checks 2 and 3 only. Check 4 still reads all three files, so a
# VALUE written into any of them fails the build like anywhere else.
RULE_TEXT=(':!scripts/audit-privacy.sh' ':!eslint-rules/*' ':!CONTRIBUTING.md')

# One finding per line as `path:line:match`, over the files git tracks under
# the pathspecs in `$2..`. The MATCH is emitted, not the whole line, so that
# `$SANCTIONED` below can exempt a form rather than a line: a line carrying
# both a sanctioned form and a real finding must still fail.
#
# Three details, each from something that produced a clean result that was not
# clean:
#
#   - The pathspecs are quoted all the way through. Unquoted, the shell expands
#     `*.md` against the working directory before git ever sees it, which
#     narrows the sweep to top-level files.
#   - `--binary-files=text` and no `-I`. `-I` asks grep to skip a file it reads
#     as binary, which is the opposite of the intent and invisible when it
#     fires.
#   - `-o`, so the unit is the MATCH and not the line. Three citations on one
#     line are three findings; counting lines reports one and reads as
#     progress.
sweep() {
  local pattern="$1"
  shift
  git ls-files -- "$@" | while IFS= read -r file; do
    [ -f "$file" ] || continue
    grep -anoE --binary-files=text -- "$pattern" "$file" 2>/dev/null | sed "s|^|$file:|"
  done | grep -avE -- "$SANCTIONED_HEADER" | grep -avE -- ":$SANCTIONED\$"
}

report() {
  local label="$1" pattern="$2"
  shift 2
  local all blocking deferred
  all="$(sweep "$pattern" "$@")"
  blocking="$(printf '%s' "$all" | grep -avE -- "$TEST_PATH")"
  deferred="$(printf '%s' "$all" | grep -aE -- "$TEST_PATH")"
  if [ -n "$deferred" ]; then
    note "$(printf '%s\n' "$deferred" | wc -l | tr -d ' ') in test paths, counted and deferred to w5-14"
  fi
  if [ -n "$blocking" ]; then
    fail "$label"
    # File and line only. The match is dropped on purpose: a build log is as
    # public as the source it refused, so it must not carry what it refused.
    printf '%s\n' "$blocking" | sed 's/:[^:]*$//' | sed 's/^/        /'
  else
    pass "$label"
  fi
}

echo "Running privacy audit..."
echo

echo "1. Checking for a private/ directory"
if [ -d "private" ]; then
  fail "private/ directory exists in the SDK (it belongs in the private repo only)"
else
  pass "No private/ directory"
fi

# Naming the private repo is unavoidable and harmless: the regeneration script
# has to name the path it runs, and a contributor has to be told where protocol
# data comes from. A path INTO it is provenance — it names a document, a
# capture or a module the reader cannot open, and says what is in it.
echo "2. Checking for paths into the private repo"
SANCTIONED='voltra-private/build\.ts'
report "No path into the private repo beyond its build entry point" \
  'voltra-private/[A-Za-z0-9_.-]+' "${RULE_TEXT[@]}"
SANCTIONED='__no_sanctioned_form__'

echo "3. Checking for capture, research and derivation references"
report "No capture, research or derivation references" \
  '(captures?/(sessions|frames)|research/[A-Za-z0-9_.-]+\.(md|json)|validation-phase|decompil|reverse.engineer)' \
  "${RULE_TEXT[@]}"

# A long hex run inside a .ts file is a value, and values ship here. The same
# run in markdown, a shell script or a workflow cannot be a value — nothing
# executes it — so it is a capture someone wrote down.
echo "4. Checking for verbatim captures in prose and configuration"
report "No verbatim capture outside executable code" \
  '(^|[^0-9A-Za-z#-])[0-9a-fA-F]{8,}([^0-9A-Za-z-]|$)' \
  '*.md' '*.mdc' '*.sh' '*.yml' '*.yaml'

echo "5. Checking for stray JSON data files in src/"
stray_json=$(find src/ -name "*.json" -not -name "package.json" -not -name "tsconfig*.json" 2>/dev/null || true)
if [ -n "$stray_json" ]; then
  fail "Stray JSON files found in src/"
  echo "$stray_json"
else
  pass "No stray JSON files"
fi

echo
if [ "$failed" -eq 0 ]; then
  echo "Privacy audit PASSED"
else
  echo "Privacy audit FAILED — review findings above"
  exit 1
fi
