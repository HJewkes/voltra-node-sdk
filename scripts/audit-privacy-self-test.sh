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
PACK_LABEL="No reference to the private repo's name in the non-dist files npm pack ships"
PACKAGE_LABEL="No reference to the private repo's name in package.json beyond its build entry point"
KEYWORD_LABEL="No capture, research or derivation references"

BASE_PACKAGE='{"name":"sandbox","version":"1.0.0","files":["dist"]}'

# Prints the audit's output for a repo holding `$2` at path `$1`. The repo
# always has a valid package.json, because check 3c asks npm what it ships;
# `$3` replaces it when a case needs a different one.
audit_output() {
  rm -rf "$SANDBOX/repo" && mkdir -p "$SANDBOX/repo/scripts" "$SANDBOX/repo/src"
  cp "$AUDIT_SCRIPT" "$SANDBOX/repo/scripts/audit-privacy.sh"
  printf '%s\n' "${3:-$BASE_PACKAGE}" > "$SANDBOX/repo/package.json"
  printf '%s\n' "$2" > "$SANDBOX/repo/$1"
  (cd "$SANDBOX/repo" && git init -q && git add -A && bash scripts/audit-privacy.sh 2>&1)
}

# `caught` means the named check FAILED, not that the audit exited nonzero.
expect_caught() {
  local label="$1" check="$2" path="$3" line="$4" package="${5:-}"
  local out
  out="$(audit_output "$path" "$line" "$package")"
  if ! printf '%s\n' "$out" | grep -qF -- "FAIL  $check"; then
    echo "FAIL  $label: check \"$check\" did not fail" >&2
    failures=$((failures + 1))
    return
  fi
  echo "PASS  $label: caught by its check"
}

expect_pass() {
  local label="$1" line="$2" path="${3:-notes.md}"
  local out
  out="$(audit_output "$path" "$line" "")"
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
expect_caught "repo name before a trailing header comment" "$NAME_LABEL" src/a.generated.ts "const x = '${repo}-private'; // @generated x Regenerate: y"
expect_caught "repo name, mixed case, in src" "$NAME_LABEL" src/a.ts "// see $(upper_first "$repo")_Private"
expect_caught "engineer keyword, doubled separator" "$KEYWORD_LABEL" notes.md "${keyword}--engineer it"
expect_caught "engineer keyword, mixed separators" "$KEYWORD_LABEL" notes.md "${keyword}_ engineer it"
expect_pass "near miss, other words" "read ${repo}_public/notes and the ${phase}_step list"
expect_pass "bare repo name outside src" "clone ${repo}-private next to this repo"

# VW-701, VW-702: the files npm pack ships outside dist. The sanctioned build
# path is the one form package.json may carry, and only in the script that runs it.
pkg_json() { printf '{"name":"sandbox","version":"1.0.0","files":["dist"],%s}' "$1"; }
sanctioned="../${repo}-private/build.ts"
expect_caught "repo name in README.md" "$PACK_LABEL" README.md "clone ${repo}-private first"
expect_caught "repo name in LICENSE" "$PACK_LABEL" LICENSE "see ${repo}_private"
expect_caught "repo name in package.json" "$PACKAGE_LABEL" package.json "$(pkg_json "\"homepage\":\"https://example.test/${repo}-private\"")"
expect_caught "repo name, upper case, in package.json" "$PACKAGE_LABEL" package.json "$(pkg_json "\"author\":\"$(printf %s "$repo" | tr a-z A-Z)-PRIVATE\"")"
expect_caught "sanctioned path named again in README.md" "$PACK_LABEL" README.md "run $sanctioned"
expect_caught "sanctioned path in package.json description" "$PACKAGE_LABEL" package.json "$(pkg_json "\"description\":\"run $sanctioned\"")"
expect_caught "sanctioned path in package.json repository" "$PACKAGE_LABEL" package.json "$(pkg_json "\"repository\":{\"type\":\"git\",\"url\":\"$sanctioned\"}")"
expect_caught "sanctioned path in another script" "$PACKAGE_LABEL" package.json "$(pkg_json "\"scripts\":{\"build\":\"npx tsx $sanctioned\"}")"
expect_caught "repo name beside the sanctioned path in its own script" "$PACKAGE_LABEL" package.json "$(pkg_json "\"scripts\":{\"generate:protocol\":\"npx tsx $sanctioned ${repo}-private\"}")"
expect_caught "repo name in a file added to package.json files" "$PACK_LABEL" CHANGELOG.md "notes from ${repo}-private" \
  '{"name":"sandbox","version":"1.0.0","files":["dist","CHANGELOG.md"]}'
expect_pass "repo name in an unpacked file" "clone ${repo}-private first" CHANGELOG.md
expect_pass "only the sanctioned path in its script" "" README.md
expect_pass "sanctioned path in generate:protocol" "$(pkg_json "\"scripts\":{\"generate:protocol\":\"npx tsx $sanctioned\"}")" package.json

[ "$failures" -eq 0 ] || exit 1
