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

audit_flags_line() {
  rm -rf "$SANDBOX/repo" && mkdir -p "$SANDBOX/repo/scripts" "$SANDBOX/repo/src"
  cp "$AUDIT_SCRIPT" "$SANDBOX/repo/scripts/audit-privacy.sh"
  printf '%s\n' "$1" > "$SANDBOX/repo/notes.md"
  (cd "$SANDBOX/repo" && git init -q && git add -A && bash scripts/audit-privacy.sh >/dev/null 2>&1)
  [ $? -ne 0 ]
}

expect() {
  local verdict="$1" label="$2" line="$3" got=pass
  audit_flags_line "$line" && got=caught
  if [ "$got" != "$verdict" ]; then
    echo "FAIL  $label: expected $verdict, got $got" >&2
    exit 1
  fi
  echo "PASS  $label: $got"
}

phase="validation"
repo="voltra"
expect caught "phase keyword, hyphen" "see the ${phase}-phase notes"
expect caught "phase keyword, underscore" "see the ${phase}_phase notes"
expect caught "phase keyword, mixed" "see the ${phase}-_phase notes"
expect caught "repo path, hyphen" "read ${repo}-private/notes"
expect caught "repo path, underscore" "read ${repo}_private/notes"
expect caught "repo path, mixed" "read ${repo}_-private/notes"
expect pass "near miss, other words" "read ${repo}_public/notes and the ${phase}_step list"
