# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- React Native bundles no longer pull the Node BLE backends. `VoltraManager`
  loaded `../bluetooth/adapters/node` and `../bluetooth/adapters/node-noble`
  through literal `require()` calls, and Metro resolves every literal
  specifier regardless of which runtime branch executes — so an RN bundle
  reached `@stoprocent/noble` -> `node:os` and failed with "Unable to
  resolve module os". Both now load through a lookup table keyed by a
  function parameter, which Babel's `evaluate()` (Metro's resolver) cannot
  constant-fold. Note that the obvious `const p = '…'; require(p)`
  indirection does **not** work: Metro folds it exactly like a literal.

  The `web` and `native` adapters deliberately keep literal `require()`s —
  `native` is the branch React Native actually executes, and Metro compiles
  an unresolvable `require()` into a runtime throw.

  No behavior change on Node: same modules, same laziness, same platform
  selection (`new VoltraManager()` still resolves `node-noble`). Verified by
  running Metro 0.84's own `collectDependencies` over the built CJS artifact
  and by constructing every adapter from both the CJS and ESM builds.
  Guarded by `src/sdk/__tests__/platform-require-opacity.test.ts`.

## [0.12.0] - 2026-07-28

### Changed

- **BREAKING (behavioral)**: Node platform auto-detection now resolves to
  `'node-noble'` instead of `'node'` (the Phase 4 promotion). A bare
  `new VoltraManager()` in Node gets the noble backend, which enumerates
  correctly and is multi-peripheral-safe. `VoltraManager.forNode()` still
  selects the legacy `webbluetooth` backend explicitly.

  The legacy backend is a picker, not a scanner: `requestDevice` selects the
  first device passing the filter and stops, so `scan()` can never return
  more than one device and, without a name filter, returns whatever
  advertises first (observed on hardware returning a television).

- **BREAKING (behavioral)**: device name-prefix filtering during scan is now
  **off by default**, except on the legacy `'node'` backend where the picker
  model makes the `VTR-` prefix load-bearing.

  Previously the `VTR-` prefix was hardcoded with no override. A Voltra
  renamed through the vendor app stops advertising `VTR-`, so it was silently
  undiscoverable — `scan()` returned an empty array with no diagnostic, and
  the only workaround was to supply a custom `host`/`adapterFactory`.

  Consumers relying on scan results being name-filtered should pass an
  explicit prefix (see below). Most should not: the advertised name is
  user-editable, so it is a poor identity signal.

### Fixed

- **The package could not be bundled for browsers at all.** Two independent
  causes, both confirmed with a real `vite build`:
  - `exports["."].browser` pointed at the CJS build, so Rollup could not read
    its named exports (`"VoltraManager" is not exported by dist/cjs/index.js`).
  - The ESM root pulls `voltra-manager.js`, which carries an injected
    `import { createRequire } from 'node:module'` shim (needed for its
    `require()` platform switch). Bundlers externalize `node:module`, so the
    build died on `"createRequire" is not exported by __vite-browser-external`
    — after transforming 215 modules and dragging in `@serialport/bindings-cpp`,
    `node-gyp-build`, and `stream`/`fs`/`path`/`os`.

  Platform-agnostic manager logic moved to `VoltraManagerCore`
  (`src/sdk/manager-core.ts`), which contains no `require()`. `VoltraManager`
  now extends it and holds only `detectPlatform` / `createAdapterFactory` /
  `createHost`, so the shim stays confined to that one module. A browser
  bundle built from the new `./web` entry transforms 41 modules and pulls no
  Node dependencies. Public API is unchanged.

- `NobleHost.scan()` returned every advertising device, not just Voltras.
  noble accepts the service-UUID filter passed to `startScanningAsync` but
  does not enforce it (verified on hardware: 39 devices back, including
  headphones and household appliances). Discoveries are now checked against
  the advertised service list in JS.

- `NobleHost.scan()` evaluated each peripheral at first discovery, when noble
  has not yet populated `advertisement.serviceUuids` — that field is filled
  in from the scan response, and noble mutates the advertisement object in
  place. Scanning now collects candidates for the full window and filters
  once it closes.

### Added

- `VoltraManagerOptions.deviceNamePrefix` — opt back in to name filtering,
  e.g. `new VoltraManager({ deviceNamePrefix: VOLTRA_DEVICE_PREFIX })`.
  `null` or `''` explicitly disables it.
- `ScanOptions.deviceNamePrefix` — per-scan override of the above. Forwarded
  to `BluetoothHost.scan()`, whose `HostScanOptions.deviceNamePrefix` the
  manager previously never populated.
- `VOLTRA_DEVICE_NAME_PREFIX` environment variable (Node only), consulted
  when no explicit prefix is given.
- New exports: `resolveDeviceNamePrefix`, `DEVICE_NAME_PREFIX_ENV_VAR`.
- `VoltraManager.resolvedPlatform` and `VoltraManager.resolvedDeviceNamePrefix`
  getters, for diagnosing discovery problems.
- `examples/node/scan-diagnostics.ts` — prints what a Node backend discovers
  and which devices a given prefix would filter out. Run one backend per
  invocation; initializing both native BLE stacks in one process segfaults.

`isVoltraDevice(device, prefix?)` and `filterVoltraDevices(devices, prefix?)`
now take an optional already-resolved prefix and pass everything through when
it is absent. They do NOT consult the environment — resolution happens once,
in `VoltraManager`, so an explicit opt-out cannot be resurrected by the env
var. `VOLTRA_DEVICE_PREFIX` still exports `'VTR-'` but is no longer applied
automatically.

## [0.11.0] - 2026-05-13

### Added

- `VoltraClient.unloadDevice()` — disengages the cable motor by sending
  `Workout.STOP` (the canonical "stop resistance/tracking" primitive paired
  with `Workout.GO`). Needed before `startGuidedLoad` so the firmware emits
  the visible countdown ceremony; `exitGuidedLoad` only clears software
  state and leaves the cable mechanically loaded, which causes a subsequent
  guided-load to short-circuit to `phase: 'active'` with no countdown.
  Bypasses the recording-state guard so it works as a generic pre-guided-
  load unload regardless of whether a recording was started. Idempotent.
  Validated end-to-end on hardware 2026-05-13 (Workout.GO → unloadDevice
  cleanly disengages both bilateral slots).

### Changed

- `setEccentric(overloadLbs)`: the param name and JSDoc now correctly
  describe the unit as **pounds added to the eccentric phase**, not a
  percentage of base weight. The previous `percent` name mis-described
  the unit — firmware behavior is unchanged, this is a docstring + param-
  name correction at the SDK seam. The function signature is a single
  positional `number`, so no caller breaks at compile time. The
  `useVoltra()` React hook's `setEccentric` callback mirrors the rename.

## [0.7.1] - 2026-05-09

Restores two fixes that were originally written for 0.6.1 / 0.6.2 but never
merged before the 0.6.0 → 0.7.0 cascade.

### Fixed

- `VoltraManager.connect()` on Node no longer throws
  `"No device selected. Call scan() first."` after `scan()`. The
  `scanAdapter` is now reused for the first connect on Node (matching web
  behavior). Cherry-picked from `cddf7e0`. Without this, every Node consumer
  hits the error on first connect against real hardware.

### Added

- `client.onRawFrame((data: Uint8Array) => void)` — fires for every inbound
  BLE notification before decode, including frames that decode to `'unknown'`.
  Diagnostic surface for byte-level work. Cherry-picked from `b3e3dc3`.
- `client.onSettingsUpdate(cb)` now replays the most recent cached
  `DeviceSettings` cascade synchronously on attach if a cascade has already
  been observed. Closes the bridge-bootstrap-timing window where consumers
  attached after `await manager.connect()` resolved missed the initial
  settings cascade. Cherry-picked from `b3e3dc3`.

### Why this wasn't in 0.7.0

The fixes lived on `feat/onrawframe-and-bootstrap-replay` (a 0.6.x branch)
and were never merged. The 2026-05-07 release went 0.6.0 → 0.7.0 directly.
The 2026-05-07 evening on-device validation session caught the regression;
0.7.1 restores both.

## [0.6.0] - UNRELEASED

### Added

- Eight mode-config setters on `VoltraClient`: `setDamperLevel`, `setAssistMode`,
  `setBandMaxForce`, `setIsokineticTargetSpeed`, `setIsokineticEccMode`,
  `setIsokineticEccSpeedLimit`, `setIsokineticEccConstWeight`,
  `setIsokineticEccOverloadWeight`. Each ships with a matching `getAvailable*`
  helper and underlying `get*Command` builder in
  `voltra/protocol/commands.ts`.
- Four `@experimental` QoL setters: `setTelemetryRate`, `setTelemetrySubscribe`,
  `setCableTrigger`, `setResistanceExperience`. Underlying registers were
  validated in voltra-private PR #11 but not yet validated end-to-end on-device.
- Typed vendor-frame events on `VoltraClient`: `onPerRep`, `onSummary`,
  `onPreSummary`, `onInProgress`. Each callback receives a typed event payload
  (`PerRepEvent`, `SummaryEvent`, `PreSummaryEvent`, `InProgressEvent`) decoded
  from the underlying vendor sub-type frame. New `'perRep'` / `'summary'` /
  `'preSummary'` / `'inProgress'` variants on the `VoltraClientEvent`
  discriminated union.
- Pure decoder entry points: `decodeVendorPerRep`, `decodeVendorSummary`,
  `decodeVendorPreSummary`, `decodeVendorInProgress`. Re-exported from the
  package root.
- `VendorMessages`, `matchesVendorSubType`, and `VendorSchemaVersion` constants
  exported from the package root.
- `damperLevel?: number` field on `VoltraDeviceSettings` and
  `DeviceSettings`. Reflected from device `settingsUpdate` notifications
  (paramId `0x0351`, uint8) and surfaced on `client.settings.damperLevel`.

### Changed

- `MessageType` strings renamed for clarity: `'rep_summary'` →
  `'vendor_per_rep'`, `'set_summary'` → `'vendor_in_progress'`. New
  `'vendor_summary'` / `'vendor_pre_summary'` strings cover the two
  end-of-set vendor frames the SDK now decodes. Only matters if you call
  `identifyMessageType()` directly.
- `decodeNotification()` returns `'unknown'` for vendor frames whose payload
  fails to fully parse (truncation or sub-type mismatch). Previously these
  downgraded to the legacy payload-less `'rep_boundary'` / `'set_boundary'`
  results.

### Removed

- **Breaking:** `VoltraClient.onRepBoundary` and `VoltraClient.onSetBoundary`
  payload-less listeners. Subscribe to `onPerRep` / `onInProgress` instead —
  they receive typed payload events. See `MIGRATION.md`.
- **Breaking:** `'repBoundary'` / `'setBoundary'` variants on the
  `VoltraClientEvent` discriminated union.
- **Breaking:** `'rep_boundary'` / `'set_boundary'` variants on the
  `DecodeResult` union returned by `decodeNotification()`.
- **Breaking:** `RepBoundaryListener` and `SetBoundaryListener` type aliases.

## [0.4.2] - 2026-05-05

### Fixed

- Multi-device support: `VoltraManager.connect` now creates a fresh BLE adapter per
  client. Previously all clients shared one adapter whose singleton `device` /
  `server` / `writeChar` fields were clobbered on each connect, causing every
  write (`setWeight`, `setMode`, etc.) to land on the most-recently-connected
  peripheral regardless of which `VoltraClient` issued it.

## [0.4.1] - 2026-05-04

### Fixed

- ESM build of `voltra-manager` no longer throws "require is not defined" under stock Node ESM. A post-build script (`scripts/inject-esm-require-shim.mjs`) prepends `createRequire(import.meta.url)` to the dist output so the lazy-loaded BLE adapter factories work in both CJS and ESM contexts.
- `BLEAdapter.scan(timeout)` now consistently treats `timeout` as milliseconds. The `node` and `native` adapters previously multiplied the value by 1000 even though every consumer (manager default, mobile, MCP) passed milliseconds; scan durations were 1000× longer than intended. Typedoc updated to match.

## [0.3.0] - 2026-02-16

### Added

- `MockBLEAdapter` — simulates a connected Voltra device with realistic telemetry streaming for visual development and Playwright testing where Web Bluetooth is unavailable
- `VoltraManager.forMock()` factory method for creating a manager with the mock adapter
- `'mock'` platform option in `Platform` type union
- `MockBLEConfig` interface for configuring mock device behavior (device name, scan/connect delays, weight, reps per set, rest period)
- Telemetry simulation follows real device phase cycle (IDLE → CONCENTRIC → HOLD → ECCENTRIC) at ~11Hz with rep/set boundary notifications and per-rep fatigue model

## [0.2.1] - 2026-02-15

### Fixed

- Telemetry decoder now correctly handles mixed-size notification parameters — param IDs in `Uint16ParamIds` are parsed as 2-byte uint16 LE values, all others as 1-byte uint8
- `generate:protocol` script now points to `voltra-private/build.ts` (was referencing a removed path)

### Added

- `Uint16ParamIds` constant exported from protocol constants for identifying 2-byte notification params
- `uint16ParamIds` field on `TelemetryConfig` type interface
- Test coverage for mixed-size parameter parsing in settings update notifications

### Changed

- `decodeSettingsUpdate` uses variable-length offset tracking instead of fixed `paramSize` stride
- Package author updated to "Henry Jewkes"

## [0.1.1] - 2026-01-22

### Fixed

- BLE adapter config now correctly maps constant names (SCREAMING_SNAKE_CASE to camelCase)

### Changed

- Rewrote Getting Started docs from library user perspective (not repo contributor)
- Updated README with comprehensive feature documentation
- Improved Quick Start to show scan → select → connect workflow
- Added Core Concepts section explaining resistance settings, recording lifecycle, and telemetry
- Enhanced example files to demonstrate full SDK functionality

## [0.1.0] - 2026-01-22

### Added

- Initial SDK structure with BLE adapters for React Native, browser, and Node.js
- `VoltraClient` high-level API for single device management
- `VoltraManager` for multi-device fleet management
- React hooks (`useVoltraScanner`, `useVoltraDevice`) for React/React Native apps
- Protocol implementation for Voltra device communication
- TypeScript types for all public APIs
