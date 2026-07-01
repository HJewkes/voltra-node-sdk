# Mock-to-Real Device Behavior Alignment — Test Plan

**Status**: Design (SDK-02.07). No implementation in this document.

As `MockBLEAdapter` grows — error injection, configurable device
parameters, per-mode kinematics, multi-set session simulation — the risk
is **drift**: the mock and a real Voltra device diverge in behavior, tests
stay green against the mock, and a bug only surfaces on hardware. This doc
proposes a strategy to keep the two aligned. It has three parts:

1. A **unified contract harness** that runs the same test body against
   both mock and real adapters.
2. The **behavior contracts** both adapters must satisfy, grounded in the
   interfaces that already define the abstraction.
3. A **capture/replay drift-detection** flow that plays recorded real
   sessions back through the SDK and diffs the decoded result against a
   golden expectation.

Where infrastructure already exists it is named explicitly, so this is
mostly a plan to *extend and formalize* what's there rather than build
from scratch.

## What already exists (the foundation)

Three pieces of the puzzle are already in the repo:

### 1. The contract interfaces

`src/bluetooth/adapters/types.ts` defines the abstraction every backend
implements:

- **Legacy**: `BLEAdapter` — `scan`, `connect`, `disconnect`, `write`,
  `onNotification`, `onConnectionStateChange`, `getConnectionState`,
  `isConnected`, `isLinkAlive`.
- **Phase 0 split**: `BluetoothHost` (`scan`, `dial`, `isAvailable`,
  `getKnownDiscoveries`, `dispose`) + `Peripheral` (`status`, `write`,
  `onNotification`, `onStatusChange`, `disconnect`) + `Discovery`.
- **Status model**: the `PeripheralStatus` union
  (`connecting`/`connected`/`disconnecting`/`disconnected`/`lost`) and the
  typed errors `PeripheralLost` and `PeripheralRebound`.

These interfaces *are* the contract surface. The alignment question is:
"does every concrete implementation of these interfaces behave the same
where the interface says it should?"

Implementations today: `MockBLEAdapter`, `ReplayBLEAdapter`,
`WebBLEAdapter`, `NodeBLEAdapter`, `NativeBLEAdapter` (all via
`BaseBLEAdapter` + `LegacyAdapterHost`/`LegacyAdapterPeripheral`), and the
Phase 1 `NobleHost`/`NoblePeripheral` (native `Peripheral`).

### 2. The contract test registry

`src/bluetooth/adapters/__tests__/host-contract.test.ts` already runs a
**single set of invariants against a registry of backends**. Its shape is
exactly the harness we want to generalize:

```ts
const backends: Array<{ case: BackendCase; build: () => BackendFixture }> = [ ... ];
for (const backend of backends) {
  describe(`BluetoothHost contract — ${backend.case.label}`, () => { /* same invariants */ });
}
```

It covers `LegacyAdapterHost` (in-memory `TestRecordingAdapter`), the
mocked `NobleHost`, and a real-`MockBLEAdapter` smoke row. It already
encodes the key discipline this doc formalizes:

- `expectedFailures` — invariants a backend *knowingly* fails (the legacy
  webbluetooth `'rescan'` case, annotated with `it.fails()`).
- `hardwareOnly` / `it.skip` blocks — invariants that **cannot** run in CI
  without real BLE hardware, documented as explicit gaps rather than
  silently omitted.

### 3. Replay + capture format

- `ReplayBLEAdapter` (`src/bluetooth/adapters/replay.ts`) plays a
  `TelemetryFrame[]` back through the `BLEAdapter` notification interface
  with timing reconstructed from each frame's `timestamp`, using
  `encodeTelemetryFrame()` so consumers can't tell it from a real device.
  Controls: `play`/`pause`/`seek`/`setSpeed`.
- Real device sessions are captured as **JSONL** in
  `voltra-private/captures/sessions/*.jsonl`. Each line is one event; the
  relevant record is:
  `{"type":"frame_in","ts":<ms-since-start>,"hex":"<lowercase-hex>","label":...,"tier":...,"cmdByte":...}`
  (schema documented in `voltra-private/docs/architecture/captures.md`).
- Roundtrip codec: `encodeTelemetryFrame()` / `decodeTelemetryFrame()` /
  `decodeNotification()` (exported from the package root).

The gap: `ReplayBLEAdapter` consumes `TelemetryFrame[]`, but captures are
JSONL hex. Nothing in the **public SDK** bridges the two — see
[Identified gaps](#identified-gaps).

## Part 1 — Unified contract harness

**Goal**: one test body, many backends, so a behavior assertion written
once is enforced against the mock *and* (where runnable) the real
adapters.

**Approach**: generalize the `host-contract.test.ts` registry into a
reusable, exported harness rather than a single test file's local array.

Proposed shape (a testing-only helper, exported from
`@voltras/node-sdk/testing` so downstream integration suites can reuse it):

```ts
interface AdapterUnderTest {
  label: string;
  /** Build a fresh host for one test. */
  buildHost: () => BluetoothHost | Promise<BluetoothHost>;
  /** Capabilities this backend can actually exercise in the current env. */
  capabilities: {
    liveTelemetry: boolean;    // emits a running session (mock, replay, real)
    errorInjection: boolean;   // can synthesize disconnect/drop/etc. (mock only)
    realHardware: boolean;     // needs a powered device present
  };
  /** Invariants this backend knowingly fails, with a tracking reference. */
  knownFailures?: Array<{ invariant: string; reason: string; ref: string }>;
}

function runAdapterContract(subject: AdapterUnderTest): void;
```

`runAdapterContract` iterates the invariant set (Part 2). For each
invariant it checks the subject's `capabilities`:

- runnable + expected pass → `it(...)`
- runnable + `knownFailures` entry → `it.fails(...)` with the reason/ref in
  the title (mirrors today's `expectedFailures`)
- not runnable in this environment → `it.skip(...)` tagged
  `[hardware]` / `[capability:X]` so skipped-for-good-reason is visible in
  the report and never looks like accidental omission.

**Registered subjects**:

| Subject | How it runs in CI |
|---|---|
| `MockBLEAdapter` via `LegacyAdapterHost` | full — the reference behavior |
| `ReplayBLEAdapter` (fixture frames) via `LegacyAdapterHost` | telemetry + lifecycle invariants |
| `NobleHost` with mocked `@stoprocent/noble` | full host/peripheral invariants (as today) |
| `NodeBLEAdapter` / `WebBLEAdapter` / `NativeBLEAdapter` | `realHardware: true` — skipped in CI, runnable in an opt-in on-hardware job |

The real-hardware subjects are gated behind an env flag (e.g.
`VOLTRA_HW_TEST=1`) and a device-name argument, so the *same* invariant
bodies run against a physical device in a manual/nightly lane. CI stays
green and hardware-only gaps stay explicit — the discipline
`host-contract.test.ts` already practices, lifted into a reusable harness.

## Part 2 — Behavior contracts

The invariants both adapters must satisfy, each tied to the interface
method(s) it constrains. These are the assertions `runAdapterContract`
enforces.

### Connection lifecycle (`BluetoothHost.dial`, `Peripheral.status`, `Peripheral.onStatusChange`)

- `dial()` on a valid `Discovery` resolves with `status === 'connected'`.
- A clean `disconnect()` emits `disconnecting` → `disconnected` and never
  `lost`.
- An *unsolicited* drop (device powers off / `gattserverdisconnected`
  analog) flips `status` to `'lost'`, not `'disconnected'`.
- `dial()` of a `Discovery` whose `_origin` is a different host rejects.

### Write path (`Peripheral.write`, typed errors)

- `write()` after `status === 'lost'` rejects with `PeripheralLost`.
- Cross-talk: a `write()` to peripheral A never reaches peripheral B (the
  central invariant behind the Phase 0 split).
- When the underlying handle rebinds to a different device id, `write()`
  throws `PeripheralRebound` and does **not** flip status to `'lost'`
  (hardware/noble-only — the mock has no singleton to corrupt).

### Notification path (`Peripheral.onNotification`)

- Bytes delivered to `onNotification` decode via `decodeNotification()`
  without error (well-formedness).
- Multiple subscribers each receive every frame; unsubscribe stops
  delivery.

### Telemetry semantics (mock/replay/real; `capabilities.liveTelemetry`)

This is the layer most exposed to drift as the mock grows. Contracts:

- Every configured `TrainingMode` produces frames that
  `decodeTelemetryFrame()` accepts (already asserted by mock's "all modes
  produce valid decodable telemetry frames" test — promote it to the
  shared harness so real captures are held to the same bar).
- Field-range sanity: `position ≥ 0`, monotonic `sequence`, `velocity` is
  zero during `HOLD`/idle phases, force is non-negative. These are the
  *shape* contracts the real device also honors and the mock must not
  violate.
- Rep/set boundary events fire in the same order and cardinality the
  decoder expects.

### Error-injection realism (`capabilities.errorInjection` — mock only)

The mock's `ErrorInjector` (`disconnect`, `authTimeout`,
`notificationDrop`, `malformedFrame`, `reconnectCycle`) exists to
*simulate real failure modes*. The contract here is one-directional:
**every injected failure must resolve to a state the real device can also
reach.** e.g. an injected `disconnect` must drive the same
`status === 'lost'` transition a real drop does. These assertions run only
against the mock, but they assert *fidelity to* the real-adapter
invariants above — that's what keeps injection honest.

## Part 3 — Capture-and-replay drift detection

**Goal**: catch the case where the mock (or a decoder change) drifts from
recorded real-device behavior.

**Flow**:

1. **Capture** (already exists): real sessions land in
   `voltra-private/captures/sessions/*.jsonl` via the live harness. Each
   `frame_in` line carries `ts` (ms since session start) and `hex`.

2. **Load** (proposed helper — the missing bridge): a
   `loadCaptureFrames(jsonl): TelemetryFrame[]` utility in
   `@voltras/node-sdk/testing` that reads the JSONL, filters `frame_in`
   telemetry records, hex-decodes each, and runs `decodeTelemetryFrame()`
   — producing exactly the `TelemetryFrame[]` `ReplayBLEAdapter` already
   consumes, with `timestamp` taken from `ts`.

3. **Replay through the SDK**: feed those frames to `ReplayBLEAdapter`,
   drive them through a real `VoltraManager` → `VoltraClient`, and collect
   the client-level output (decoded frames, per-rep/summary events, state
   transitions).

4. **Diff against golden**: compare the collected output to a committed
   **golden fixture** derived from that capture. This is a *decoded-domain*
   diff (TelemetryFrame fields, event sequence), complementary to the
   byte-level `replay diff` that already lives in
   `voltra-private/scripts/replay.ts` for protocol RE. Volatile fields the
   existing tooling already flags — header CRC8 (offset 3), sequence
   (6–7), trailing CRC16 — are excluded from the comparison.

5. **Drift alarm**: a mismatch means either the capture corpus changed,
   the decoder changed, or the mock/replay path regressed. A small,
   version-pinned set of captures becomes a regression fixture; when a
   decoder or mock change legitimately changes output, the golden is
   regenerated in the same PR (making the behavior change reviewable).

**Format note**: `ReplayBLEAdapter` is one-way (device→app). `frame_out`
records (app→device writes) are captured but not replayed; a future
bidirectional harness could assert the SDK *emits* the same writes given
the same inbound stream, but that's out of scope here.

## Identified gaps (candidate follow-up tickets)

Grounding this plan surfaced concrete gaps worth filing:

1. **No public JSONL→`TelemetryFrame[]` loader.** `ReplayBLEAdapter` takes
   `TelemetryFrame[]`, captures are JSONL hex, and the only bridge
   (`replay.ts`) lives in `voltra-private`, not the shipped SDK. Part 3
   step 2 is blocked without a `loadCaptureFrames()` helper in
   `@voltras/node-sdk/testing`. **Small, self-contained — good first
   ticket.**

2. **Contract harness is a local array, not reusable.** The
   `host-contract.test.ts` registry can't be reused by downstream/
   integration suites. Extracting `runAdapterContract` (Part 1) makes the
   invariants a shared asset.

3. **No on-hardware lane runs the contract invariants.** Real backends are
   `it.skip`'d; there is no opt-in job that runs the *same* bodies against
   a physical device. Even a manual `VOLTRA_HW_TEST=1` runner would close
   the biggest alignment blind spot.

4. **Telemetry shape contracts are asserted only against the mock.** The
   field-range/ordering invariants in Part 2 should also run over decoded
   capture frames so the *real* corpus is held to the same bar — cheap,
   and it validates the mock's assumptions against reality.

## Non-goals / out of scope

- Implementing any of the above — this is a plan.
- A general BLE conformance suite beyond the Voltra protocol.
- Replaying the write side (app→device) — replay stays one-way for now.
- Anything in the consuming mobile app; this is SDK-internal test
  infrastructure.

## Related

- `docs/roadmap/replay-adapter.md` — the replay adapter's own roadmap
  (partially superseded: `ReplayBLEAdapter` now exists).
- `docs/concepts/platform-adapters.md` — the adapter abstraction overview.
- `voltra-private/docs/architecture/captures.md` — capture format,
  live harness, and the existing byte-level `replay diff` workflow.
