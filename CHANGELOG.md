# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.15.0] - 2026-09-17

### Breaking

Every removed or renamed public symbol, and every behaviour a caller may
depend on that changed. The entries below carry the evidence and detail.

- **`InProgressEvent` fields renamed, and one changed meaning** (VW-404).
  `peakForceTenths` → `meanPullForceTenths` and `currentForceTenths` →
  `meanReturnForceTenths` (per-rep means, not peak or live readings).
  `velocityCmPerSec` → `meanReturnSpeedMmPerSec`: it is now read from the
  right place and reported in mm/s, so its values change as well as its name.
  `targetWeightTenths` → `pullVolumeRawTenths`: a relative accumulator over
  the set, not a weight.
- **`SetSummaryEvent.repDurationMs` → `totalPullMovingTimeMs`** (VW-405). The
  value is the set's total pull moving time, not one rep's duration; it is
  equal for a one-rep set and larger for every longer one.
- **Rowing and isometric report types renamed, and now raw bytes only**
  (VW-411). `RowingSummaryEvent` → `RowingRuntimeEvent`, `RowingStatusEvent`
  → `IsometricSummaryEvent`, `decodeRowingSummary` → `decodeRowingRuntime`,
  `decodeRowingStatus` → `decodeIsometricSummary`. `DecodeResult` variants
  `'rowing_summary'` → `'rowing_runtime'` and `'rowing_status'` →
  `'isometric_summary'`; the `MessageType` members change to match. Their
  stroke rate, pace, stroke count and distance fields are removed with no
  replacement.
- **`DecodeResult` variant `'device_status'` removed** (VW-406). Read
  `settings.battery` from `'settings_update'`, or keep using `onBatteryUpdate`.
- **`DecodeResult` and `MessageType` gain `'connection_acceptance'`**, and
  **`VoltraConnectionState` gains `'awaitingAcceptance'`** (VW-403). An
  exhaustive switch over any of them needs the new case.
- **`connect()` requires the device to accept** (VW-403). It rejects with
  `ConnectionRefusedError` on a refusal or after `acceptanceTimeoutMs` of
  silence, and control setters throw `DeviceStateUnknownError` until the
  post-connect state read is answered.
- **Stops are confirmed by the device** (VW-402). `stopRecording()` and
  `endSet()` reject on a failed write where they used to resolve, and reaching
  `'idle'` / `'ready'` now requires a device report. Read `client.motorState`
  to tell a confirmed stop from an unconfirmed one.
- **`exitGuidedLoad()` now unloads the motor** (VW-279). It previously
  reported success while the device stayed loaded; a caller that ended guided
  load some other way to compensate no longer needs to.
- **Device stand-ins must send whole, sealed frames** (VW-403, VW-409). A
  stub transport must answer the handshake finish and the core-state read
  (see the new `@voltras/node-sdk/testing` helpers), and an unchecksummed
  fixture is now discarded. `encodeTelemetryFrame()` returns a whole frame
  rather than a truncated one.
- **Counters and parameter values decode differently** (VW-406). Set and rep
  counters keep their high byte, signed settings come back signed, and a
  parameter report the catalog cannot size ends early with `complete: false`
  instead of guessing.

### Added

- **`connectionState` gains `'awaitingAcceptance'`** — the init writes are out
  and the client is waiting for the device's own report of whether it accepted
  the connection. Control writes are refused here.
- **`acceptanceTimeoutMs` client option** (default 30000) — how long to wait
  for that report. An already-paired unit answers near-instantly; a first
  pairing asks the user to accept, which takes seconds.
- **`client.refreshDeviceState()` and `client.hasConfirmedState`** — ask the
  device to report weight, motor state and training mode, and check whether it
  has. The read runs once automatically after a connection is accepted.
- **`ConnectionRefusedError` and `DeviceStateUnknownError`**, with the matching
  `ErrorCode.CONNECTION_REFUSED` / `ErrorCode.DEVICE_STATE_UNKNOWN`.
- **`@voltras/node-sdk/testing` exports device-reply helpers** —
  `connectSetupReply`, `buildAcceptanceReport`, `buildCoreStateReply`,
  `isHandshakeFinishWrite`, `isCoreStateRead`, `ACCEPTANCE_STATUS_OK`,
  `DEFAULT_SIMULATED_STATE`, plus `sealEnvelope` / `scanEnvelope` for a stub
  that builds its own frames. A stub transport needs to answer the handshake
  finish and the core-state read for `connect()` to complete; one call in its
  `write()` does both. `MockBLEAdapter` answers both already.

- **`client.motorState`** — what the device last said about the cable motor.
  `'engaged'` and `'unloaded'` mean the device reported it; `'pending'` means a
  motor command is written and unanswered; `'unknown'` means we do not know,
  including after a failed write and on every fresh connection.
- **`client.requestedSettings` and `client.confirmedSettings`** — values
  written but not yet echoed back, and values the device has reported on the
  current connection. `client.settings` is unchanged and still carries
  last-known values across a reconnect; the two new views let a caller tell a
  value the device confirmed from one it was merely asked for.
  `VoltraClientState` carries all three plus `motorState`.
- **`motorConfirmationTimeoutMs` client option** (default 2000) — how long to
  wait for the device to report the result of a motor command before giving up
  on confirming it.

### Fixed

- **`exitGuidedLoad()` now unloads the motor** (VW-279). The frame it sent named
  one register and addressed another, so the device stayed loaded and the call
  reported success. Guided-load sessions had to be ended some other way, most
  visibly through voltras-mcp's `device.exit_guided_load`. `unloadDevice()` was
  never affected and is unchanged.

- **`connect()` waits for the device to accept, and re-reads state afterwards**
  (VW-403). It used to write the init frames, wait out fixed delays and declare
  success. The device's own acceptance report was never decoded, and nothing
  re-read state afterwards — so a reconnect to a device whose weight and mode
  had changed underneath reported the previous connection's values.

  `connect()` now enters `'awaitingAcceptance'` after the init writes and
  resolves only on an acceptance report carrying the accepted status. Any other
  status, or silence past `acceptanceTimeoutMs`, rejects with
  `ConnectionRefusedError`; retrying is the caller's decision, never automatic.
  Once accepted, a three-register core-state read runs, and control setters
  throw `DeviceStateUnknownError` until the device answers it. An empty reply
  does not stand in for a cached value.

  **Behaviour change for callers.** A stub transport that does not answer the
  handshake finish will now fail to connect; see the new testing helpers.
  Anything exhaustively switching on `VoltraConnectionState` needs a case for
  `'awaitingAcceptance'`. The stop primitives are deliberately *not* gated on
  confirmed state — refusing to release the cable because state is unknown
  would be the more dangerous failure.

- **A stop the device did not confirm is no longer reported as a stop**
  (VW-402). `unloadDevice()` used to set the recording state to idle as soon as
  the GATT write resolved, and `stopRecording()` caught any write error,
  warned, and went idle anyway — so a stop that never reached the device looked
  like a completed one, on the path a spoken "stop" rides.

  Each of `stopRecording()`, `unloadDevice()` and `endSet()` now waits for a
  device report newer than the one it saw before writing, re-reads device state
  once if none arrives, and reports `motorState: 'unknown'` rather than
  assuming. A failed write throws instead of being swallowed and leaves the
  motor state `'unknown'`. Without a confirming report the recording state
  stays `'stopping'`, which is retryable, rather than falsely reaching idle.

  **Behaviour change for callers.** `stopRecording()` and `endSet()` now reject
  on a failed write where they previously resolved, and reaching `'idle'` /
  `'ready'` now requires the device to answer. Read `client.motorState` to tell
  a confirmed stop from an unconfirmed one. `disconnect()` still releases
  best-effort without waiting, and leaves the motor state `'unknown'`.

- **`startRecording()`** marks the motor `'pending'` rather than leaving a
  stale `'unloaded'` in place. It does not wait for the report — a set start
  blocking on the device would be worse than an unconfirmed engage.

- **The notification path no longer assumes one notification is one frame**
  (VW-409). Every notification went straight to the decoder, several fallback
  classifications keyed on the first two header bytes alone, and no checksum
  was verified before dispatch — so a split notification was dropped, a joined
  one lost everything after the first frame, and a corrupted one could reach
  device state.

  Each device now has its own receive buffer. It finds the frame marker,
  verifies the header checksum before trusting the declared length, waits for
  the whole frame, verifies the frame checksum, dispatches, and repeats while
  complete frames remain. Bytes that cannot start a frame are discarded
  against a counter rather than logged. A frame type whose size does not fit
  the length field is handed on untouched instead of guessed at.

  All 4315 captured notifications on macOS CoreBluetooth were already exactly
  one whole frame each, so this changes nothing there; it is hardening for
  transports that make no such guarantee, react-native-ble-plx first among
  them.

  **`onRawFrame` semantics are unchanged: it still fires once per
  notification, before reassembly.** A byte-level recorder wants the transport
  as it arrived, including bytes no frame claims, so `voltras-mcp`'s debug
  recorder needs no change. The typed callbacks are what now fire once per
  reassembled frame.

  **Behaviour change for callers.** Anything standing in for a device must
  send whole, sealed frames — an unchecksummed fixture is now discarded.
  `encodeTelemetryFrame()` returns a whole frame sized as the device sizes
  one, rather than a truncated one, and `MockBLEAdapter`'s notifications and
  the `@voltras/node-sdk/testing` reply builders seal what they build.

### Documentation

- **README rows that conflicted with the code are corrected** (VW-412). The
  eccentric setter was documented and exemplified as a percentage when it takes
  signed additional pounds; the chains and inverse-chains physical
  descriptions were swapped; `prepareRecording()` was described as engaging the
  motor, which `startRecording()` does; `stopRecording()` was described as
  exiting a workout mode it does not exit; and a resolved setter was shown as
  the current device setting. The README now covers `requestedSettings` /
  `confirmedSettings`, `motorState`, `awaitingAcceptance` and
  `hasConfirmedState`, and the stale `onPreSummary` name is replaced by
  `onSetSummary`. Inverse chains is marked under review pending VW-407.

### Changed

- **Internal:** the guided-load module now reads its values from the generated
  protocol data instead of holding its own copies. No public API change, and
  every frame it builds is byte-identical — a fixture pins all three builders
  and the module's exported constants.
- **Internal:** the rowing module now reads its values from the generated
  protocol data instead of holding its own copies. No public API change, and
  every frame it builds is byte-identical — a fixture pins both builders and
  the module's exported constant.

- **Parameter reports are decoded from the generated catalog, by one decoder**
  (VW-406). The device reports its registers in two shapes — one when a value
  changes, one in reply to a read — and the two used to be walked by separate
  code that disagreed. A change report sized every value it did not recognise
  at one byte, which moved every value after it, and read a signed register
  unsigned, so an eccentric setting of -25 came back as 65511. Both shapes now
  go through one decoder that sizes each value from the generated parameter
  catalog and keeps signed registers signed. A register the catalog carries no
  width for ends the walk instead of being guessed at: `AsyncStateFrame` and
  `BulkParamResponse` gained a `complete` flag that says so, and the values
  decoded before it stay usable. A read reply whose result byte says the
  device refused the read decodes to no values at all.

- **Set and rep counters keep their high byte** (VW-406). The per-phase report
  and the workout summary carry two-byte counters; the SDK read one byte of
  each, so any count of 256 arrived as 0. `PerRepEvent.setCounter`,
  `PerRepEvent.repCount` and `SummaryEvent.setCounter` now carry what the
  device counted.

- **Battery arrives from the register that reports it** (VW-406). The device's
  battery register was decoded and then dropped on the floor, while
  `onBatteryUpdate` was fed by a frame-length coincidence — any 52-byte frame
  on that header produced a battery reading, whatever it actually was.
  Battery now reaches `onBatteryUpdate` and `settings.battery` from the
  register itself, exactly once per report that carries it, and stays absent
  when no report carries one.

- **`InProgressEvent` carries what the heartbeat actually reports** (VW-404).
  Every value in that frame is a per-rep mean the device repeats until the
  next rep boundary, and all four names said otherwise. The field called a
  peak force tracks the set weight exactly, which is what a mean pull force
  does and a peak does not; the "current" force is the return phase's mean;
  the velocity field was read one byte late, straddling the speed and the
  field after it, so it returned values in the thousands that moved with the
  speed and meant nothing on their own; and the "target weight" accumulates
  over the set rather than describing the current rep.

  **Migration.** `peakForceTenths` → `meanPullForceTenths`.
  `currentForceTenths` → `meanReturnForceTenths`. `velocityCmPerSec` →
  `meanReturnSpeedMmPerSec`, in mm/s and read at the right offset, so its
  values change as well as its name. `targetWeightTenths` →
  `pullVolumeRawTenths`, which is not a weight: it grows by roughly the set
  weight per rep, and its scaling is not pinned, so treat it as relative.
  There is no replacement for a live or peak reading in this frame; the
  per-rep boundary frame and the set summary carry those.

  The offsets now come from the generated telemetry config rather than being
  hardcoded in the decoder, and the generated frame factories can build one,
  so a test fixture and the decoder read the same metadata.

- **`SetSummaryEvent.repDurationMs` is `totalPullMovingTimeMs`, and peak power
  is read whole** (VW-405). The field is the set's total pull moving time, not
  the final rep's duration: across ten captured summaries it scales with rep
  count at a steady pace — 11 reps 11085 ms against 645 ms for one fast rep at
  the same load. The single-rep captures that first pinned it could not tell
  the two readings apart, which is how the narrower name survived.

  **Migration.** `repDurationMs` → `totalPullMovingTimeMs`. The value is
  unchanged for a one-rep set and larger for every longer set, so anything
  presenting it as a rep duration was already wrong for multi-rep sets.

  `peakPowerRaw` is now read at four bytes, where the layout carries four and
  the decoder read two. Every value captured so far fits in two, so no
  captured value changes — the truncation above 65535 was invisible by luck of
  magnitude. Both peak offsets now come from the generated telemetry config
  instead of being hardcoded in the decoder.

- **Three report families are named for what they are** (VW-411). The family
  the SDK called rowing status is the isometric summary; the one it called a
  rowing summary is rowing runtime information; and the identifier the
  generated metadata attached to an isometric summary belongs to the
  workout-state family the SDK already decodes as a state dump. The evidence
  is the vendor app's own command catalog — no frame of either renamed family
  appears in any capture we have, rowing sessions included.

  **Migration.** `RowingSummaryEvent` → `RowingRuntimeEvent`,
  `RowingStatusEvent` → `IsometricSummaryEvent`, `decodeRowingSummary` →
  `decodeRowingRuntime`, `decodeRowingStatus` → `decodeIsometricSummary`. The
  `DecodeResult` variants `'rowing_summary'` and `'rowing_status'` become
  `'rowing_runtime'` and `'isometric_summary'`, and the `MessageType` members
  change to match.

  **Both events now carry raw bytes only.** The stroke rates, paces, stroke
  counts and distances they used to report came from an external layout that
  overflows the frame length one of these families declares, and the other
  family is not rowing at all, so its "distance" described nothing. A
  consumer that was reading those fields has no replacement and should treat
  the family as undecoded.

  Routing is driven by the generated identifiers, and a frame's family no
  longer depends on its length. The dispatcher now names these three families
  plus the waveform chunk explicitly as unsupported rather than falling
  through silently, and a compile-time exhaustiveness check makes a new
  decode result impossible to leave unrouted by accident.

### Removed

- **The `device_status` decode result** (VW-406). Nothing produces it: it only
  ever carried the length-inferred battery reading described above. The
  `onBatteryUpdate` callback and the `batteryUpdate` client event are
  unchanged — a consumer switching on `DecodeResult['type']` should drop its
  `'device_status'` case and read `settings.battery` from `'settings_update'`.

## [0.14.0] - 2026-09-08

### Fixed

- **Mock telemetry now emits velocity in the same unit as the real device.**
  `TelemetryFrame.velocity` is mm/s (the decoder has documented this all
  along), but the mock's `ModeConstants` and its damper/isokinetic builders
  were emitting an unlabelled magnitude with no defined unit. Consumers that
  convert frame velocity from mm/s (e.g. `voltras-mcp`'s bridge) got peak
  speeds off by an order of magnitude in mock-driven tests. The frame type's
  JSDoc now names the unit for both `velocity` and `position`, and the mock
  scales its internal cm/s magnitudes to mm/s before returning them.

## [0.13.0] - 2026-09-08

### Added

- **`SetSummaryEvent` now carries the device's own per-set peak numbers**, so
  consumers can cross-check the peaks they derive from telemetry themselves.

  `peakForceTenths` is peak force in tenths of a pound. Corroborated offline
  across nine archived capture sessions — it reads at or just above the set's
  target weight in every weight-mode capture, across three target weights, and
  takes sensible untargeted values in band, damper and isokinetic. Not
  vendor-confirmed.

  `peakPowerRaw` is deliberately **not** labelled watts. The device emits the
  field and it scales with rep speed the way power should, but the magnitude
  has never been checked against an instrumented reference, so it may be watts,
  centiwatts or another scaling. Treat it as a relative quantity and do not
  present it to users as watts until a hardware measurement pins the unit.

### Security

- Pin `tar` to `^7.5.21` via a package override, clearing a critical advisory
  that reached the production tree through an optional native dependency's
  build toolchain. Resolution-only; no other dependency versions changed.

## [0.12.3] - 2026-07-29

### Fixed

- **`forMock()` now exists on the per-platform entries — and actually returns
  a mock.** `entries/web.ts` has documented `forMock()` as working since
  0.12.0, but `forMock` was a static on the CONCRETE `VoltraManager` only, so
  calling it through the `browser` (or the new `react-native`) export
  condition was a type error. Worse, the obvious workaround
  `new VoltraWebManager({ platform: 'mock' })` silently built a **Web
  Bluetooth** adapter, because the entry's `createAdapterFactory` ignored the
  platform entirely. Both halves are fixed, on both entries.

  Surfaced while migrating a React Native consumer onto 0.12.2; the
  `?mock` / visual-dev path depends on it. Regression-tested behaviourally
  (`forMock()` connects to a simulated device in a bare test process with no
  BLE stack present), and the test is mutation-verified — reverting the
  adapter factory turns it red.

## [0.12.2] - 2026-07-29

### Added

- **React Native entry point** (`src/entries/react-native.ts`), wired to the
  `react-native` export condition so the package ROOT resolves there under
  Metro. App code keeps writing `from '@voltras/node-sdk'`. Exposes
  `VoltraNativeManager` (aliased as `VoltraManager`), the native adapter,
  the mock adapter, the client, and the full protocol/type surface — and
  never reaches `bluetooth/adapters/node`, `node-noble`, or the adapters
  barrel. Mirrors the existing `browser`-condition entry, including its
  guard test. Also available explicitly as `@voltras/node-sdk/react-native`.

  **Non-breaking**: Node and browser consumers resolve exactly as before.

### Fixed

- **0.12.1 did not actually let React Native bundle the SDK — this does.**
  Making `voltra-manager.ts`'s `require()` calls opaque was necessary but
  NOT sufficient: the package root had a SECOND path to the Node backends.
  `index.ts` value-exports `createBLEAdapter` from `../bluetooth/adapters`,
  and that barrel statically re-exports `NobleHost` from `./node-noble`, so
  a Metro bundle still reached `@stoprocent/noble` -> `node:os` and still
  failed with "Unable to resolve module os". Fixing one door does not help
  while the other stands open.

  Verified the only way that counts: `expo export --platform ios` against a
  real app with its Metro resolver stub REMOVED. Bundles, 2124 modules. The
  sourcemap's module list shows `entries/react-native.js` present and
  `voltra-manager.js`, `adapters/node.js`, `adapters/node-noble.js`,
  `@stoprocent/noble` and `webbluetooth` all absent, with
  `react-native-ble-plx` present as a positive control. A module-graph
  argument is not evidence; bundle the app.

## [0.12.1] - 2026-07-29

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
  running Metro's own `collectDependencies` (checked on both 0.83.3 and
  0.84.4) over the built CJS artifact — which is what the `react-native`
  export condition resolves to — and by constructing every adapter from both
  the CJS and ESM builds.
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
