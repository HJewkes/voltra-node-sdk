#!/usr/bin/env bash
# Generated-output verification for the Voltra Node SDK (VW-225).
#
# The generated files are committed, so they can be hand-edited, and a content
# guard cannot tell a reworded comment from legitimate output. That happened:
# generated output was edited to make `audit:privacy` pass, and the audit went
# green on content regeneration does not produce. The fix belongs in the
# private template; nothing in this repo could say the fix had gone anywhere
# else.
#
# This closes that by regenerating and comparing. It is the only check here
# with a root of trust outside the repo, so it is the only one an edit to the
# repo cannot satisfy.
#
# Byte comparison, not an AST comparison: nothing is being rewritten, so bytes
# are both stricter and simpler. A reworded comment is a difference.
#
# Log hygiene, same rule as `audit-privacy.sh`: a build log is as public as the
# source it refused. Paths and counts are reported. Differing CONTENT never is,
# and neither is generator output, which names what it built.
#
# Needs the private repository. There is deliberately no mode where a missing
# generator produces a pass — a check that passes when it cannot run is the
# failure it exists to catch.
#
# Usage: npm run verify:generated
#        VOLTRA_PRIVATE_PATH=../voltra-private npm run verify:generated

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PRIVATE_PATH="${VOLTRA_PRIVATE_PATH:-../voltra-private}"

# Every tree the generator writes into. Each is generated in its ENTIRETY, so a
# file that appears in one without the generator producing it is a finding too.
GENERATED_ROOTS=(
  'src/voltra/protocol/_factories'
  'src/voltra/protocol/data'
)

die() { echo "  FAIL  $1" >&2; exit 1; }

if [ ! -d "$PRIVATE_PATH" ]; then
  echo "Cannot verify generated output: the private repository is not at $PRIVATE_PATH." >&2
  echo "  This check regenerates and compares, so it needs the generator itself." >&2
  echo "  It runs in CI. Set VOLTRA_PRIVATE_PATH to run it locally." >&2
  exit 1
fi

GENERATOR="$PRIVATE_PATH/build.ts"
RUNNER="$PRIVATE_PATH/node_modules/.bin/tsx"
[ -f "$GENERATOR" ] || die "no generator entry point at $GENERATOR"
[ -x "$RUNNER" ] || die "private repository dependencies are not installed (no $RUNNER)"

FRESH="$(mktemp -d)"
trap 'rm -rf "$FRESH"' EXIT

echo "Verifying generated output against the generator..."
echo

# `--sdk-path` is mandatory here. Without it the generator defaults to a
# sibling checkout and would write over a real working tree.
GENERATOR_LOG="$(mktemp)"
trap 'rm -rf "$FRESH" "$GENERATOR_LOG"' EXIT
"$RUNNER" "$GENERATOR" --sdk-path "$FRESH" >"$GENERATOR_LOG" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  echo "  FAIL  the generator exited $status" >&2
  # Its output names what it built and the paths it read. Shown only on
  # request, and never in CI.
  if [ "${VERIFY_GENERATED_SHOW_OUTPUT:-}" = '1' ]; then
    cat "$GENERATOR_LOG" >&2
  else
    echo "        output withheld; set VERIFY_GENERATED_SHOW_OUTPUT=1 locally to see it" >&2
  fi
  exit 1
fi

# One `path<TAB>verdict` per finding. The verdict is a fixed phrase, so no
# amount of file content can reach the log through it.
findings=''
checked=0

for root in "${GENERATED_ROOTS[@]}"; do
  paths="$(
    { [ -d "$root" ] && (cd "$root" && find . -type f -print)
      [ -d "$FRESH/$root" ] && (cd "$FRESH/$root" && find . -type f -print)
    } | sed 's|^\./||' | sort -u
  )"
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    checked=$((checked + 1))
    tree="$root/$rel"
    fresh="$FRESH/$root/$rel"
    if [ ! -f "$fresh" ]; then
      findings+="$tree"$'\t'"in the tree, not produced by the generator"$'\n'
    elif [ ! -f "$tree" ]; then
      findings+="$tree"$'\t'"produced by the generator, missing from the tree"$'\n'
    elif ! cmp -s "$tree" "$fresh"; then
      findings+="$tree"$'\t'"differs from generator output"$'\n'
    fi
  done <<< "$paths"
done

[ "$checked" -gt 0 ] || die "the generator produced nothing and the tree holds nothing — check the generated paths"

if [ -z "$findings" ]; then
  echo "  PASS  $checked generated file(s) match the generator byte for byte"
  echo
  echo "Generated-output verification PASSED"
  exit 0
fi

count="$(printf '%s' "$findings" | grep -c .)"
echo "  FAIL  $count of $checked generated file(s) do not match the generator" >&2
printf '%s' "$findings" | while IFS=$'\t' read -r path verdict; do
  echo "        $path — $verdict" >&2
done
echo >&2
echo "Generated-output verification FAILED" >&2
echo "  The tree is not what the generator produces. A generated file was" >&2
echo "  edited, or the generator changed and the output was not regenerated." >&2
echo "  Fix the private template and regenerate; never edit the output." >&2
exit 1
