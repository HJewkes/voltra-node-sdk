# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
