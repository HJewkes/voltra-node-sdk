# voltra-node-sdk

TypeScript SDK for Voltra devices over BLE. Commands are in `package.json`; `npm run ci:local` runs the CI gate.

## Gotchas

- CI's `lint` job also runs `npm run format:check` (prettier), so a clean local `npm run lint` can still fail it; run `npm run ci:local` before pushing.
- `npm run verify:generated` regenerates from `VOLTRA_PRIVATE_PATH` (default `../voltra-private`); when it fails on a clean `main`, fast-forward that checkout before suspecting a generated file.
- CI clones voltra-private's default branch, so a PR pair that changes the generator stays red here until the voltra-private PR merges; land that one first.
- `@stoprocent/noble` accepts a service-UUID filter in `startScanningAsync` without enforcing it, and fills `advertisement.serviceUuids` only after the scan response; filter candidates after the scan window, never at first discovery.
- Concurrent `writeAsync` calls on one noble peripheral lose all but the last callback (`onceExclusive`); keep the per-peripheral `writeQueue` in `node-noble.ts`, pinned by `noble-once-exclusive-bug.test.ts`.
- Before publishing a release that touches the connect path (`voltra-manager.ts`, `voltra-client.ts` connect and bootstrap, the BLE adapter layer), reproduce connect and first write on real hardware; matching git history to a known-good session is not enough.
