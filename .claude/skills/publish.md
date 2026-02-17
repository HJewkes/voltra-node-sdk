# Publish SDK to npm

Use when the user says "publish", "release", "cut a release", or wants to push a new version to npm.

## Release Lifecycle

Publishing is handled by GitHub Actions — never run `npm publish` locally.

### Pipeline: `.github/workflows/release.yml`

Triggered by pushing a `v*` tag to `main`. Three jobs run in sequence:

1. **validate** — `npm ci`, lint, typecheck, test, build
2. **publish** — builds again, verifies tag version matches `package.json`, publishes with `--provenance --access public` using `NPM_TOKEN` secret
3. **github-release** — creates a GitHub Release with auto-generated release notes (marks as prerelease if tag contains `-alpha`, `-beta`, or `-rc`)

### CI: `.github/workflows/ci.yml`

Runs on every push to `main` and all PRs. Jobs: gitleaks, security audit, lint+format+typecheck, test with coverage, build verification, Node 20+22 matrix.

## Steps to Release

### 1. Pre-flight (already done if you just finished a feature)

```bash
cd voltra-node-sdk
npm run ci:local    # lint + format + typecheck + test + build
```

### 2. Version bump (if not already done)

Update `package.json` version and `CHANGELOG.md`:

- **Patch** (`0.2.1` → `0.2.2`): bug fixes only
- **Minor** (`0.2.1` → `0.3.0`): new features, backward compatible
- **Major** (`0.2.1` → `1.0.0`): breaking changes

Add a dated `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md` under `[Unreleased]`.

### 3. Commit the version bump

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release vX.Y.Z"
git push
```

### 4. Tag and push

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

This triggers the release workflow.

### 5. Monitor

```bash
# Watch the GitHub Actions run
gh run list --workflow=release.yml --limit 3
gh run watch          # live tail the latest run

# Or open in browser
gh run view --web
```

### 6. Verify

```bash
# Check npm after publish completes (~2-3 min)
npm view @voltras/node-sdk version
npm view @voltras/node-sdk versions --json

# Check GitHub Release was created
gh release list --limit 3
```

### 7. Update consumers

After publishing, update `voltras/mobile` (and any other consumers):

```bash
cd ../voltras/mobile
npm install @voltras/node-sdk@latest
npm run typecheck && npm test
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Tag/package.json version mismatch | The publish job verifies they match. Fix `package.json`, amend commit, re-tag. |
| npm auth failure | OIDC trust may be misconfigured — check npm package Settings → Publishing Access → Trusted Publishers |
| Validate job fails | Fix the issue on `main` first, delete the tag (`git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`), re-tag after fix |
| Need to unpublish | `npm unpublish @voltras/node-sdk@X.Y.Z` (only within 72h, use sparingly) |
