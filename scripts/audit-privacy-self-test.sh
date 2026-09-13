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
