#!/usr/bin/env bash
# Self-test for the audit-privacy.sh untracked-file check (VW-227).
#
# The audit sweeps `git ls-files`, so a file that exists on disk but hasn't
# been `git add`ed is invisible to it. This creates exactly that file under a
# swept path, asserts the audit now fails loudly rather than passing clean,
# then removes the file whether the assertion passed or not.
#
# Usage: bash scripts/audit-privacy-self-test.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

SCRATCH_FILE="docs/__vw227_untracked_self_test.md"

cleanup() {
  rm -f "$SCRATCH_FILE"
}
trap cleanup EXIT

if git ls-files --error-unmatch "$SCRATCH_FILE" >/dev/null 2>&1; then
  echo "FAIL  $SCRATCH_FILE is already tracked — pick a different scratch name" >&2
  exit 1
fi

echo "scratch file for VW-227's audit-privacy self-test" > "$SCRATCH_FILE"

if bash scripts/audit-privacy.sh >/dev/null 2>&1; then
  echo "FAIL  audit-privacy.sh passed with an untracked file on disk ($SCRATCH_FILE) — the untracked-file check regressed" >&2
  exit 1
fi

echo "PASS  audit-privacy.sh fails loudly with an untracked file present"

# VW-697: the provenance patterns accept hyphen, underscore and mixed
# separators. Fixtures are assembled from parts so this file never spells a
# keyword itself. AUDIT_SCRIPT lets a run target another version of the audit.
AUDIT_SCRIPT="${AUDIT_SCRIPT:-$REPO_ROOT/scripts/audit-privacy.sh}"
SANDBOX="$(mktemp -d)"
trap 'cleanup; rm -rf "$SANDBOX"' EXIT

failures=0
PATH_LABEL="No path into the private repo beyond its build entry point"
NAME_LABEL="No reference to the private repo's name in src/"
KEYWORD_LABEL="No capture, research or derivation references"

# Prints the audit's output for a one-file repo holding `$2` at path `$1`.
audit_output() {
  rm -rf "$SANDBOX/repo" && mkdir -p "$SANDBOX/repo/scripts" "$SANDBOX/repo/src"
  cp "$AUDIT_SCRIPT" "$SANDBOX/repo/scripts/audit-privacy.sh"
  printf '%s\n' "$2" > "$SANDBOX/repo/$1"
  (cd "$SANDBOX/repo" && git init -q && git add -A && bash scripts/audit-privacy.sh 2>&1)
}

# `caught` means the named check FAILED, not that the audit exited nonzero.
expect_caught() {
  local label="$1" check="$2" path="$3" line="$4"
  local out
  out="$(audit_output "$path" "$line")"
  if ! printf '%s\n' "$out" | grep -qF -- "FAIL  $check"; then
    echo "FAIL  $label: check \"$check\" did not fail" >&2
    failures=$((failures + 1))
    return
  fi
  echo "PASS  $label: caught by its check"
}

expect_pass() {
  local label="$1" line="$2"
  local out
  out="$(audit_output notes.md "$line")"
  if printf '%s\n' "$out" | grep -q -- "FAIL  "; then
    echo "FAIL  $label: expected pass, got a failure" >&2
    failures=$((failures + 1))
    return
  fi
  echo "PASS  $label: pass"
}

upper_first() { printf %s "$(printf %s "${1:0:1}" | tr a-z A-Z)${1:1}"; }

phase="validation"
repo="voltra"
keyword="reverse"
expect_caught "phase keyword, hyphen" "$KEYWORD_LABEL" notes.md "see the ${phase}-phase notes"
expect_caught "phase keyword, underscore" "$KEYWORD_LABEL" notes.md "see the ${phase}_phase notes"
expect_caught "phase keyword, mixed" "$KEYWORD_LABEL" notes.md "see the ${phase}-_phase notes"
expect_caught "repo path, hyphen" "$PATH_LABEL" notes.md "read ${repo}-private/notes"
expect_caught "repo path, underscore" "$PATH_LABEL" notes.md "read ${repo}_private/notes"
expect_caught "repo path, mixed" "$PATH_LABEL" notes.md "read ${repo}_-private/notes"
# VW-699: parity with the ESLint rule's case-insensitive, separator-tolerant shapes.
expect_caught "phase keyword, mixed case" "$KEYWORD_LABEL" notes.md "see the $(upper_first "$phase")-Phase notes"
expect_caught "repo path, upper case" "$PATH_LABEL" notes.md "read $(printf %s "$repo" | tr a-z A-Z)-PRIVATE/notes"
expect_caught "repo path, trailing separator" "$PATH_LABEL" notes.md "read ${repo}-private-/notes"
expect_caught "repo name without a path, in src" "$NAME_LABEL" src/a.ts "// see ${repo}-private"
expect_caught "repo name, mixed case, in src" "$NAME_LABEL" src/a.ts "// see $(upper_first "$repo")_Private"
expect_caught "reverse-engineer keyword, doubled separator" "$KEYWORD_LABEL" notes.md "${keyword}--engineer it"
expect_caught "reverse-engineer keyword, mixed separators" "$KEYWORD_LABEL" notes.md "${keyword}_ engineer it"
expect_pass "near miss, other words" "read ${repo}_public/notes and the ${phase}_step list"
expect_pass "bare repo name outside src" "clone ${repo}-private next to this repo"

[ "$failures" -eq 0 ] || exit 1
