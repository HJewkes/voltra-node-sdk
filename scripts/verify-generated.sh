#!/usr/bin/env bash
# Generated-output verification for the Voltra Node SDK (VW-225).
#
# The generated files here are committed, so they can be hand-edited, and a
# content guard cannot tell a reworded comment from legitimate output. That
# happened: generated output was edited to make `audit:privacy` pass, and the
# audit went green on content regeneration does not produce.
#
# This file only LOCATES the generator. The comparison itself lives with the
# generator, in the private repository, and both halves of the check call that
# one implementation. It is deliberately not a file in this tree: it is this
# tree being judged, and a judgement that lives here could be edited by the
# same change it exists to catch.
#
# The other half needs nothing from here. This repository is public, so the
# private repository's CI clones it and runs the same comparison on a schedule,
# with no credential — which is what still covers a pull request opened from a
# fork, where GitHub withholds the deploy key this half needs.
#
# Usage: npm run verify:generated
#        VOLTRA_PRIVATE_PATH=../voltra-private npm run verify:generated

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIVATE_PATH="${VOLTRA_PRIVATE_PATH:-../voltra-private}"

if [ ! -d "$PRIVATE_PATH" ]; then
  echo "Cannot verify generated output: the private repository is not at $PRIVATE_PATH." >&2
  echo "  This check regenerates and compares, so it needs the generator itself." >&2
  echo "  It runs in CI. Set VOLTRA_PRIVATE_PATH to run it locally." >&2
  exit 1
fi

COMPARISON="$PRIVATE_PATH/scripts/verify-generated.sh"
if [ ! -f "$COMPARISON" ]; then
  echo "Cannot verify generated output: $COMPARISON is missing." >&2
  echo "  The comparison lives with the generator. Update the private repository." >&2
  exit 1
fi

exec bash "$COMPARISON" --sdk-path "$REPO_ROOT"
