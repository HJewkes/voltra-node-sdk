# Testing

Test layout, MockBLEAdapter feature surface, and how on-device validation differs from unit testing.

## Contents

- [Test runner](#test-runner)
- [Test layout](#test-layout)
- [MockBLEAdapter feature surface](#mockbleadapter-feature-surface)
- [Coverage thresholds](#coverage-thresholds)
- [Vitest config quirks](#vitest-config-quirks)
- [On-device validation](#on-device-validation)

## Test runner

[Vitest](https://vitest.dev/) — `vitest.config.ts` (root). Commands defined in `package.json:69-76`:

| Command | Purpose |
|---------|---------|
| `npm test` | Single-run (`vitest run`) |
| `npm run test:watch` | Interactive watch |
| `npm run test:coverage` | v8 coverage report |
| `npm run ci:local` | `lint + format:check + typecheck + test + build` |

CI runs the full suite on every PR (`.github/workflows/ci.yml`) and on every release tag (`.github/workflows/release.yml`).

Local pre-commit hook (`.husky/pre-commit`) runs `vitest related` against staged files only — full suite is too heavy for local commits.

## Test layout

Tests live next to source under `__tests__/` directories:

```
src/
├── __tests__/errors.test.ts                                        (1)
├── sdk/__tests__/                                                  (6)
│   ├── voltra-manager.test.ts
│   ├── voltra-client-setters.test.ts
│   ├── voltra-client-vendor-events.test.ts
│   ├── notification-dispatcher.test.ts
│   ├── reconnect-handler.test.ts
│   └── multi-device-routing.test.ts
├── voltra/protocol/__tests__/                                      (4)
│   ├── commands.test.ts
│   ├── telemetry-decoder.test.ts
│   ├── telemetry-codec.test.ts
│   └── vendor-decoders.test.ts
├── voltra/models/__tests__/                                        (3)
│   ├── connection.test.ts
│   ├── device-filter.test.ts
│   └── frame.test.ts
└── bluetooth/adapters/__tests__/                                   (5)
    ├── mock.test.ts
    ├── mock-session.test.ts
    ├── mock-rep-plan.test.ts
    ├── mock-errors.test.ts
    └── mock-device-params.test.ts
```

Vitest collects via `include: ['src/**/*.test.ts', 'src/**/*.spec.ts']` (`vitest.config.ts:7`).

### What's tested where

| Layer | Coverage strategy |
|-------|-------------------|
| Errors | Direct construction + `instanceof` checks |
| Protocol decoders | Golden-frame fixtures (raw bytes → expected typed output), roundtrip encode-decode, sub-type matching |
| Protocol commands | Lookup-table coverage for every documented setter range |
| Models | State-machine transitions, predicates, defaults |
| SDK | Behavior tests against `MockBLEAdapter` injected as the BLE handle |
| Mock adapter | Self-tests for kinematics, sessions, rep plans, error injection, device params |

There are **no** Web/Node/Native adapter tests — those depend on real BLE stacks. They are exercised on-device or via the MockBLEAdapter standing in for them.

## MockBLEAdapter feature surface

Source: `src/bluetooth/adapters/mock.ts` + `src/bluetooth/adapters/mock/`. Used for unit tests, the `voltras-mcp` dev mode, and Playwright tests where `navigator.bluetooth` is unavailable.

### Telemetry simulation

| Feature | Source |
|---------|--------|
| 30-byte encoded telemetry frames at ~11 Hz | `mock.ts:387-461` (`SAMPLE_INTERVAL_MS = 91`, `mock/types.ts:100`) |
| 7 training-mode kinematics profiles | `mock/profiles.ts` (`KINEMATICS_PROFILES`) |
| Phase-progression math (position/velocity/force per progress fraction) | `mock/kinematics.ts` |
| Per-rep fatigue (`FATIGUE_RATE = 0.03`) | `mock.ts:411`, `mock/types.ts:101` |
| Rep + set boundary notifications | `mock/notifications.ts` (`buildRepBoundary`, `buildSetBoundary`) |
| Mode confirmation notifications | `mock/notifications.ts` (`buildModeConfirmation`) |
| Mode switching via write detection | `mock.ts:145-150` (`detectModeCommand`) |

### Session config

`MockSessionConfig` (`mock/types.ts:42-70`) supports multi-set scenarios:

| Field | Purpose |
|-------|---------|
| `sets`, `repsPerSet`, `restBetweenSetsMs` | Multi-set lifecycle |
| `pauseSet` | Intra-set pauses (cluster sets) |
| `tempo` | Per-phase sample-count overrides (concentric/hold/eccentric/idle) |
| `interSetRecovery` | Fatigue-recovery fraction between sets |

Pre-built scenario factories (`mock/session-config.ts`):

- `createMultiSetScenario()`
- `createPauseSetScenario()`
- `createTempoScenario()`
- `createShortRestScenario()`

### Deterministic rep plans

`MockBLEAdapter.setRepPlan(profiles: PlannedRepProfile[])` (`mock.ts:172-`) replaces fatigue-based phase cycling with exact per-rep timing + ROM. Useful for analytics tests that need known-truth rep boundaries. `clearRepPlan()` reverts to normal cycling.

### Device parameters

`DeviceParameterConfig` (`mock/types.ts:7-16`) lets tests configure device identity + simulation knobs:

| Field | Default | Purpose |
|-------|---------|---------|
| `serialNumber` | `'VLT-000000'` | Identity |
| `firmwareVersion` / `hardwareVersion` / `modelName` | `'1.0.0'` / `'1.0'` / `'Voltra'` | Identity |
| `batteryLevel` | 100 | Drains 1%/min during motor engagement |
| `rssi` | -60 dBm | Returned with gaussian noise (σ=5) |

`getDeviceParams()`, `getBatteryLevel()`, `getRssi()` (`mock.ts:230-251`).

### Error injection

`ErrorScenarioType` union (`mock/types.ts:154-159`):

| Scenario | Effect |
|----------|--------|
| `disconnect` | Force-disconnect after `afterMs` |
| `authTimeout` | Block during `connect()` for `timeoutMs`, then disconnect (simulates auth failure) |
| `notificationDrop` | Drop a fraction of outgoing notifications (`dropRate`) |
| `malformedFrame` | Corrupt a fraction of outgoing frames (`corruptionRate`) |
| `reconnectCycle` | Disconnect-then-reconnect loop |

API: constructor `errorScenario`/`errorConfig` options, plus runtime `injectError(type, config)` and `clearErrors()` (`mock.ts:201-221`). Implementation: `mock/error-injector.ts`.

### Runtime reconfiguration

`MockBLEAdapter.configure(partial)` (`mock.ts:194-199`) updates runtime-relevant fields (`trainingMode`, `repsPerSet`, etc.) mid-stream. Connect-time fields (`scanDelayMs`, `connectDelayMs`, `deviceId`, `deviceName`) only take effect on the next `scan` / `connect` cycle.

## Coverage thresholds

`vitest.config.ts:11-17`:

| Metric | Threshold |
|--------|-----------|
| Lines | 60% |
| Functions | 60% |
| Branches | 50% |
| Statements | 60% |

These are intentionally modest — adapter-layer code is not unit-tested (depends on real BLE), so 100% line coverage isn't achievable without integration infrastructure.

## Vitest config quirks

- `globals: true` — `describe`/`it`/`expect` available without import.
- `environment: 'node'` — no jsdom; tests that need DOM must spin one up explicitly.
- `resolve.alias: { '@': './src' }` — bare `@/...` imports resolve to `src/...`.
- No `setupFiles`. No `server.deps.inline`. Compare: `voltras/mobile`'s vitest config needs `inline: ['@titan-design/react-ui']` for RN-adjacent code, but the SDK has no such requirement (it does not import any RN packages directly — `react-native-ble-plx` is a peer).

## On-device validation

Some SDK behavior cannot be unit-tested:

- Adapter implementations against real Web Bluetooth / `webbluetooth` / `react-native-ble-plx`.
- Vendor-frame field offsets against actual device output.
- Setter side-effects (e.g. audible beeps from `setIsokineticEccConstWeight`).
- Mode confirmation echo from the device.

Validation captures live in `voltra-private/captures/sessions/` (private repo). The 2026-05-06 phase-5 corpus comprises 21 JSONL captures, 2,544 frames. Cross-reference + decoder gap analysis in `coordination/research/audit-2026-05-06-captures.md`.

For new field offsets:

1. Validate in `voltra-private` (capture script + manual inspection).
2. Bake offsets into the regen output (`telemetry-config-source.generated.ts` + `protocol-data.generated.ts`).
3. Re-run `npm run generate:protocol` in the SDK to consume.
4. Add a unit test with a captured frame as a fixture under `vendor-decoders.test.ts` or `telemetry-decoder.test.ts`.

`inProgress` decoder offsets (`telemetry-decoder.ts:316-320`) are still empirically hardcoded because `cfg.fieldsValidated === false` for that sub-type. The capture audit suggests one bug: `velocityCmPerSec` is read as `uint16` but protocol-reference labels it `int16`. See `status.md`.
