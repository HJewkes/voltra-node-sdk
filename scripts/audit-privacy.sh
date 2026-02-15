#!/usr/bin/env bash
# Privacy audit for the Voltra Node SDK.
# Scans for accidental leaks of proprietary protocol data.
# Usage: npm run audit:privacy

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

failed=0

pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; failed=1; }

echo "Running privacy audit..."
echo

# 1. No private/ directory
echo "1. Checking for private/ directory"
if [ -d "private" ]; then
  fail "private/ directory exists in SDK (should only be in voltra-private)"
else
  pass "No private/ directory"
fi

# 2. No raw protocol hex prefix outside generated file
echo "2. Checking for raw protocol hex patterns"
if grep -ri "55130403" --include="*.ts" src/ | grep -v "protocol-data.generated.ts" | grep -q .; then
  fail "Raw protocol hex prefix (55130403) found in source files"
  grep -ri "55130403" --include="*.ts" src/ | grep -v "protocol-data.generated.ts"
else
  pass "No raw protocol hex patterns"
fi

# 3. No CRC init constant
echo "3. Checking for CRC init constant"
if grep -rE "0x3692|3692" --include="*.ts" src/ | grep -v "protocol-data.generated.ts" | grep -q .; then
  fail "CRC init constant (0x3692) found in source files"
  grep -rE "0x3692|3692" --include="*.ts" src/ | grep -v "protocol-data.generated.ts"
else
  pass "No CRC init constant"
fi

# 4. No private repo references in source
echo "4. Checking for private repo references"
if grep -riE "voltra-private|private.*protocol|private.*data" --include="*.ts" src/ | grep -v "protocol-data.generated.ts" | grep -q .; then
  fail "Private repo references found in source files"
  grep -riE "voltra-private|private.*protocol|private.*data" --include="*.ts" src/ | grep -v "protocol-data.generated.ts"
else
  pass "No private repo references in source"
fi

# 5. No stray JSON data files
echo "5. Checking for stray JSON files in src/"
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
