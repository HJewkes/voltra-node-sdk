---
name: publish-sdk
description: Review, version, and publish the Voltra Node SDK to npm. Use when the user wants to push, publish, release, or version the SDK, or asks to prepare a release, cut a new version, or ship the package.
---

# Publish SDK

End-to-end workflow for reviewing, versioning, and publishing the `@voltras/node-sdk` package.

## Prerequisites

- Protocol data is generated from `voltra-private/build.ts` (sibling repo), not from this repo.
- Release is triggered by pushing a `v*` tag — `.github/workflows/release.yml` handles npm publish.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `refactor:`, etc.).
- Changelog follows [Keep a Changelog](https://keepachangelog.com/) format.

## Workflow

Copy this checklist and track progress with the TodoWrite tool:

```
- [ ] Step 1: Code review
- [ ] Step 2: Privacy audit
- [ ] Step 3: Run tests and linters locally
- [ ] Step 4: Version bump, changelog, commit, and PR
- [ ] Step 5: Monitor CI
- [ ] Step 6: Merge PR
- [ ] Step 7: Tag and trigger npm publish
```

---

### Step 1: Code Review

Review all local changes for correctness, quality, and risk.

```bash
git diff            # unstaged
git diff --cached   # staged
git status
```

For each changed file, evaluate:

- **Correctness**: Does the logic do what it claims? Edge cases handled?
- **Types**: Are TypeScript types accurate and not using `any` escapes?
- **API surface**: Do public exports change? Is it backward-compatible?
- **Tests**: Are new behaviors tested? Were existing tests updated?

Flag issues to the user using severity levels:
- **CRITICAL** — Must fix before release (bugs, type errors, breaking changes)
- **WARNING** — Should fix (code smells, missing tests, unclear naming)
- **NOTE** — Optional improvements

If there are critical issues, stop and ask the user to resolve them before continuing.

---

### Step 2: Privacy Audit

The SDK is public. The protocol is proprietary. Scan for accidental leaks.

**Automated checks** — run from the repo root:

```bash
# Ensure no private/ directory exists (should be in voltra-private only)
ls -la private/ 2>/dev/null && echo "FAIL: private/ directory exists in SDK" || echo "OK: no private/ directory"

# Search for raw protocol hex patterns (55130403aa10 is the command prefix)
rg -i "55130403" --type ts --glob '!**/protocol-data.generated.ts' src/

# Search for CRC init constant
rg "0x3692|3692" --type ts --glob '!**/protocol-data.generated.ts' src/

# Search for private repo references that shouldn't be public
rg -i "voltra-private|private.*protocol|private.*data" --type ts src/

# Check for stray JSON data files
find src/ -name "*.json" -not -name "package.json" -not -name "tsconfig*.json"
```

**Manual checks** on the diff:
- No raw hex command strings outside `protocol-data.generated.ts`
- No comments describing protocol byte layout in detail (register addresses, CRC algorithms, etc.)
- No references to internal investigation docs or private repo paths
- The `.gitignore` should not have been modified to track `private/`

If any leak is found, stop and report to the user.

---

### Step 3: Run Tests and Linters Locally

Run the full CI suite before pushing:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test
npm run build
```

All must pass. If any fail, report the errors and fix them (or ask the user).

---

### Step 4: Version Bump, Changelog, Commit, and PR

**4a. Determine version bump**

Ask the user what kind of release this is, or infer from the changes:
- `patch` — bug fixes, dependency bumps, non-functional changes
- `minor` — new features, new exports, non-breaking additions
- `major` — breaking API changes

**4b. Update `package.json` version**

Bump the `version` field in `package.json`. Current version can be read with:

```bash
node -p "require('./package.json').version"
```

**4c. Update `CHANGELOG.md`**

Move items from `[Unreleased]` to a new version section. Follow the existing format:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Changed
- Modifications to existing features

### Fixed
- Bug fixes
```

Write a thorough changelog entry based on the actual diff — not just commit messages. Group by Added/Changed/Fixed/Removed as appropriate.

**4d. Create release branch and commit**

```bash
git checkout -b release/vX.Y.Z
git add package.json CHANGELOG.md
# Include any other files that are part of this release
git add <changed files>
git commit -m "chore: release vX.Y.Z

<2-3 sentence summary of what's in this release>"
```

**4e. Push and create PR**

```bash
git push -u origin release/vX.Y.Z
```

Create PR with `gh pr create`. Use the PR template format:

```
## Summary
Release vX.Y.Z — <brief description>

## Changes
- <key changes from changelog>

## Test Plan
- All CI checks pass (lint, typecheck, test, build, gitleaks, security audit)
- Verified locally: `npm run lint && npm run typecheck && npm run test && npm run build`

## Breaking Changes
<any breaking changes, or "None">
```

---

### Step 5: Monitor CI

Wait for CI to complete on the PR. The CI pipeline runs these jobs:
- `gitleaks` — secret scanning
- `security-audit` — npm audit
- `lint` — eslint + prettier + typecheck
- `test` — vitest with coverage
- `build` — ESM + CJS + types verification
- `node-matrix` — Node 20 + 22 compatibility

```bash
gh pr checks <PR-number> --watch
```

If any check fails, investigate, fix locally, amend or add a commit, and push again.

**Do not proceed until all checks are green.**

---

### Step 6: Merge PR

Once all checks pass, merge the PR:

```bash
gh pr merge <PR-number> --squash --delete-branch
```

Use `--squash` to keep main history clean. The squash message should be the release commit message.

Then update local main:

```bash
git checkout main
git pull origin main
```

---

### Step 7: Tag and Trigger npm Publish

Create and push the version tag. This triggers `.github/workflows/release.yml` which:
1. Validates (lint, typecheck, test, build)
2. Verifies the tag matches `package.json` version
3. Publishes to npm with provenance
4. Creates a GitHub Release with auto-generated notes

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Monitor the release workflow:

```bash
gh run list --workflow=release.yml --limit=1
gh run watch <run-id>
```

Verify the publish succeeded:

```bash
npm view @voltras/node-sdk version
```

Report the final published version and GitHub Release URL to the user.
