# Contributing to @voltras/node-sdk

## The confidentiality boundary

### Why it exists

Beyond Power shared the device's internals informally, to help this community
SDK exist, and asked that they not be shared publicly. That is a
**confidentiality boundary** — a trust commitment. Nothing was signed, so write
"confidentiality boundary" and never write "NDA".

The commitment is about ongoing exposure, not about undoing anything. This repo
has been public for its whole history and no scrub changes that. What the rules
below buy is that the exposure stops growing.

### What IS allowed here, and why

Read this half first. The SDK's job is to decode a device, so a rule that
banned protocol values would be incoherent, and a rule people know is
incoherent gets switched off within a week.

- **Protocol values in executable code.** Constants, lookup tables, offsets,
  checksum parameters and frame layouts in `.ts` files are the package's
  function. `src/index.ts` exports the protocol constant barrels as supported
  public API; consumers rely on them.
- **Everything under `_factories/*.generated.ts` and `data/*.generated.ts`.**
  These are build output. They regenerate from the private toolchain and ship
  the values it emits, by design.
- **Naming the private repository.** `package.json`'s `generate:protocol`
  script has to name the path it runs, and generated files carry a
  regeneration header so a contributor knows where to edit instead of editing
  the output. The name of a repo is not the contents of one.
- **A hex-shaped BLE UUID.** It is public API and hex-shaped by definition.
- **A device-name prefix in a documentation example.** `connectByName` is
  documented with it, and no rule can separate a placeholder from a real unit's
  serial. Real serials are covered by the review checklist below instead.

### What is NOT allowed

Everything *around* the values: where they came from, and captures reproduced
verbatim.

- **A path into the private repository** beyond its build entry point. A
  comment naming a module, document or capture the reader cannot open is
  provenance: it says what is in a place they have no access to.
- **Capture, research and derivation references.** Capture-session paths,
  research documents, named validation phases, decompilation and
  reverse-engineering of the device.
- **A command code welded into a symbol name.** `parseCmd10` and
  `CMD_0X10_LATCH` disclose the same number a constant does, and a symbol name
  is never load-bearing the way a value is: nothing decodes worse for a symbol
  named after what it does.
- **A capture reproduced verbatim in a comment**, or in markdown, shell or
  workflow files. A long hex run in an expression is a value; the same run in
  prose is a capture someone wrote down. Position is the whole difference.
- Any of the above in a **commit message, PR title or PR body**. Describe
  removals by file and line.

Protocol-derived findings belong in the private repository's research tree.

### What enforces it

| layer | covers | runs |
| --- | --- | --- |
| `voltras/no-private-provenance` (`eslint-rules/`) | provenance, command-code identifiers, and verbatim captures in comments, across `src/**/*.ts` | `npm run lint`, CI |
| `scripts/audit-privacy.sh` | the whole tree git tracks, as text — including the generated files ESLint ignores, and markdown, shell and workflow files no linter reads | `npm run audit:privacy`, CI |
| `scripts/verify-generated.sh` | the generated files, against what the generator actually produces, byte for byte | `npm run verify:generated`, CI |

All three name the file and the shape and never the token. A build log is as
public as the source it refused.

The first two read this repository, so an edit to this repository can satisfy
them: a reworded comment looks like legitimate content to a content guard, and
generated output has been edited to make the audit pass. The third exists for
that. Its root of trust is the generator, which lives in the private
repository, so nothing you can write here makes it green.

Two things about it are worth knowing before you read a green check as
coverage:

- **It needs a secret and fails until that secret exists.** CI reads a
  read-only deploy key from `VOLTRA_PRIVATE_DEPLOY_KEY`. There is no fallback
  that passes without it.
- **It cannot run on a pull request opened from a fork,** because GitHub
  withholds secrets there. It goes red rather than green on those, which is the
  honest outcome, but it means a fork's generated output is unverified.

It is not part of `npm run ci:local`, which has to work for a contributor who
does not have the private repository. Run it with
`VOLTRA_PRIVATE_PATH=../voltra-private npm run verify:generated` if you do.

The audit's exclusion covers the sanctioned **regeneration header line**, never
a **file**. Excluding a generated file wholesale would hide anything written
below its header behind the header's own legitimacy — which is what the
previous version of the script did, for one of the five generated files.

Editing a generated file by hand is always wrong, and the confidentiality rules
are not the exception people reach for them as: if a regeneration reintroduces
provenance, the fix belongs in the private template, never in the output.
`verify:generated` enforces that, so an edit to the output now fails CI whatever
its motive.

### What no rule covers: prose

A sentence that names a register and describes what writing to it does carries
no value in any shape a pattern can match. **A partial redaction is worse than
none** — a masked value next to an intact mechanism sentence reads as a
decision someone already made rather than as an oversight.

So prose is a **review-checklist item**. When a change touches device
behaviour, read the prose and ask whether a reader could reconstruct anything
from it. The same applies to a device serial, which no shape separates from a
documentation placeholder.

### Exemptions

Exemptions are inline, at the site, with a stated reason after `--`, and the
full set is enumerated by `src/__tests__/no-private-provenance.test.ts`
rather than trusted. Unused directives are an error, so one left behind after
its line changed fails the build.

The exemptions that exist today are the two exported `MessageType` members that
still carry command codes. They are a known finding, kept only because renaming
a published union member is a breaking API change; the rename belongs in a
major release, not in a lint fix.

Test trees are exempt by path glob pending their own follow-up (w5-14). The
audit still **counts** and reports what is in them on every run: an exclusion
that governs what gets fixed must never govern what gets counted.
