# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
