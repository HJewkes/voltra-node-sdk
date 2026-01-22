# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
