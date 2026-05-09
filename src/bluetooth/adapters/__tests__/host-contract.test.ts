/**
 * BluetoothHost / Peripheral contract test suite — Phase 0 (2026-05-08).
 *
 * Every backend MUST satisfy these invariants. Violations are a stop-the-line
 * condition for the host/peripheral abstraction.
 *
 *  1. Cross-talk: a write to peripheral A never reaches peripheral B.
 *  2. Re-scan does not invalidate an open peripheral.
 *  3. `peripheral.write()` runtime id-mismatch throws `PeripheralRebound`.
 *
 * The legacy webbluetooth-backed Web/Node hosts WILL fail (2) — the upstream
 * `webbluetooth` `SimplebleAdapter` singleton overwrites its peripherals Map
 * on every scan, including for already-connected addresses. Those cases are
 * marked `it.fails()` until Phase 1 swaps the library. Mock must pass green.
 *
 * See: coordination/architecture/ble-adapter-refactor-2026-05-08.md §6
 *      coordination/bug-investigations/sdk-fresh-connect-cross-talk-2026-05-08.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  BLEAdapter,
  BluetoothHost,
  ConnectionStateCallback,
  Device,
  Discovery,
  NotificationCallback,
  Peripheral,
} from '../types';
import { PeripheralRebound } from '../types';
import { LegacyAdapterHost, LegacyAdapterPeripheral } from '../legacy-shim';
import { BaseBLEAdapter } from '../base';
import { MockBLEAdapter } from '../mock';

// =============================================================================
// Test fixture: an in-memory BLEAdapter used to build a `LegacyAdapterHost`.
//
// Each instance carries its own write log; multiple instances are bridged by
// a shared `BackendBus` so cross-talk regressions can be modeled or refuted.
// =============================================================================

interface BackendBus {
  /**
   * Cross-talk simulator hook. When set, every write through ANY adapter on
   * this bus is mirrored to the bus's `crossTalkTarget` adapter as if the
   * underlying library had rebound the peripherals Map (the upstream
   * `webbluetooth` SimplebleAdapter bug). Used to assert that the
   * Host/Peripheral abstraction *catches* the cross-talk before it does
   * damage.
   */
  crossTalkTarget?: TestRecordingAdapter | null;
}

class TestRecordingAdapter extends BaseBLEAdapter {
  readonly writes: Uint8Array[] = [];
  readonly knownDevices: Device[];
  /**
   * Identity reported by `getActualPeripheralId()`. Mutating this from
   * outside lets a test simulate the upstream `webbluetooth` cross-talk
   * bug (peripherals Map rebound to a different device).
   */
  reportedActualId: string | null = null;
  private bus: BackendBus | null;

  constructor(devices: Device[], bus: BackendBus | null = null) {
    super();
    this.knownDevices = devices;
    this.bus = bus;
  }

  async scan(_timeout: number): Promise<Device[]> {
    return [...this.knownDevices];
  }

  async connect(_deviceId: string): Promise<void> {
    this.setConnectionState('connecting');
    this.setConnectionState('connected');
  }

  async disconnect(): Promise<void> {
    this.setConnectionState('disconnected');
  }

  async write(data: Uint8Array): Promise<void> {
    this.writes.push(new Uint8Array(data));
    // Cross-talk simulator. If the bus has a redirection target set,
    // mirror the write there — this models the upstream library
    // re-routing through a rebound handle.
    if (this.bus?.crossTalkTarget && this.bus.crossTalkTarget !== this) {
      this.bus.crossTalkTarget.writes.push(new Uint8Array(data));
    }
  }
}

// =============================================================================
// Backend registry: each entry is one (Host factory, label, expected status).
// Tests iterate the registry to apply the same invariants to every backend.
// =============================================================================

interface BackendCase {
  /** Display label, used in describe blocks. */
  label: string;
  /**
   * Build a host pre-loaded with two test devices. The host MUST be
   * disposable — tests call `host.dispose()` in cleanup.
   */
  buildHost: () => BluetoothHost;
  /**
   * Backends that don't (yet) survive the re-scan invariant — annotated
   * with vitest's `it.fails()`. `'rescan'` is the canonical case for
   * legacy webbluetooth-backed Web/Node; Phase 1 (noble migration)
   * removes it from this list.
   */
  expectedFailures?: Array<'rescan'>;
  /**
   * Note on hardware-required cases: some invariants fundamentally
   * cannot run in unit tests without real BLE hardware. Listing them
   * here makes the gap explicit instead of pretending coverage.
   */
  hardwareOnly?: Array<'identityMismatch'>;
}

const deviceA: Device = { id: 'device-a', name: 'VTR-AAAAAA', rssi: -50 };
const deviceB: Device = { id: 'device-b', name: 'VTR-BBBBBB', rssi: -60 };

/**
 * Build a `LegacyAdapterHost` whose factory hands out per-instance
 * recording adapters from an in-test bus. Each test gets a fresh bus.
 */
function buildLegacyMockHost(bus: BackendBus): {
  host: BluetoothHost;
  bus: BackendBus;
  createdAdapters: TestRecordingAdapter[];
} {
  const createdAdapters: TestRecordingAdapter[] = [];
  const host = new LegacyAdapterHost(() => {
    const adapter = new TestRecordingAdapter([deviceA, deviceB], bus);
    createdAdapters.push(adapter);
    return adapter;
  });
  return { host, bus, createdAdapters };
}

// =============================================================================
// Helper: run a contract block against any backend.
// =============================================================================

interface BackendFixture {
  host: BluetoothHost;
  /** Last test-fixture bus, when applicable. */
  bus: BackendBus;
  createdAdapters: TestRecordingAdapter[];
}

const backends: Array<{
  case: BackendCase;
  build: () => BackendFixture;
}> = [
  {
    case: {
      label: 'LegacyAdapterHost (TestRecordingAdapter — multi-device fixture)',
    },
    build: () => {
      const bus: BackendBus = {};
      return buildLegacyMockHost(bus);
    },
  },
  // -------------------------------------------------------------------------
  // The real platform-specific backends (`Web` / `Node` / `Native`) cannot
  // run in CI — each one needs the platform's actual BLE stack:
  //
  //   - WebBLEAdapter: needs `navigator.bluetooth.requestDevice` (browser
  //     with a user gesture). Vitest runs in node; the API is undefined.
  //   - NodeBLEAdapter: needs `webbluetooth` + a real BLE adapter on the
  //     host. CI doesn't have one. The legacy webbluetooth backend would
  //     ALSO fail the `'rescan'` invariant against real hardware due to
  //     the upstream `SimplebleAdapter` singleton bug
  //     (`coordination/bug-investigations/sdk-fresh-connect-cross-talk-2026-05-08.md`).
  //     Phase 1's noble migration provides a backend that passes; until
  //     then this case is hardware-only.
  //   - NativeBLEAdapter: needs `react-native-ble-plx` + a running Android
  //     or iOS device. Out of scope for CI.
  //
  // The TestRecordingAdapter row above exercises the Host/Peripheral
  // abstraction itself; the real-backend rows would only re-test the
  // shared `LegacyAdapterHost` machinery against different concrete
  // adapters. Phase 1 adds a noble-backed row that runs in CI (no
  // hardware required for the noble protocol-level scan/dial logic
  // when stubbed).
];

// =============================================================================
// Generic contract suite — runs against every backend in the registry.
// =============================================================================

for (const backend of backends) {
  describe(`BluetoothHost contract — ${backend.case.label}`, () => {
    let fixture: BackendFixture;

    beforeEach(() => {
      fixture = backend.build();
    });

    it('host produces discoveries from scan() that dial() can consume', async () => {
      const discoveries = await fixture.host.scan({ timeout: 10 });
      expect(discoveries.length).toBeGreaterThanOrEqual(1);
      for (const d of discoveries) {
        expect(d._origin).toBe(fixture.host);
      }
    });

    it('dial() rejects a discovery from a different host (origin mismatch)', async () => {
      const otherFixture = backend.build();
      const [otherDiscovery] = await otherFixture.host.scan({ timeout: 10 });
      // Cast through unknown to violate the type check — we are
      // exercising the runtime origin assertion specifically.
      const foreignDiscovery = otherDiscovery as unknown as Discovery;
      await expect(fixture.host.dial(foreignDiscovery)).rejects.toThrow(/different host/i);
      await otherFixture.host.dispose();
    });

    it('cross-talk: write to peripheral A never reaches peripheral B', async () => {
      const [discA, discB] = await fixture.host.scan({ timeout: 10 });
      const pA = await fixture.host.dial(discA);
      const pB = await fixture.host.dial(discB);

      const SENTINEL_A = new Uint8Array([0xa1, 0xa2]);
      const SENTINEL_B = new Uint8Array([0xb1, 0xb2]);

      await pA.write(SENTINEL_A);
      await pB.write(SENTINEL_B);

      // The recording adapters carry per-instance write logs. With the
      // Phase 0 type-level split (one Peripheral handle per device,
      // backed by a per-peripheral adapter) writes can ONLY land on the
      // adapter the peripheral was constructed with.
      const adapterA = unwrapAdapter(pA);
      const adapterB = unwrapAdapter(pB);
      expect(adapterA).not.toBe(adapterB);
      expect(adapterA.writes.some((w) => bytesEqual(w, SENTINEL_A))).toBe(true);
      expect(adapterA.writes.some((w) => bytesEqual(w, SENTINEL_B))).toBe(false);
      expect(adapterB.writes.some((w) => bytesEqual(w, SENTINEL_B))).toBe(true);
      expect(adapterB.writes.some((w) => bytesEqual(w, SENTINEL_A))).toBe(false);

      await pA.disconnect();
      await pB.disconnect();
    });

    /**
     * Re-scan invariant: after dialing a peripheral, running another
     * `host.scan()` must NOT flip the open peripheral to `'lost'` and
     * must NOT invalidate writes through it.
     *
     * Legacy webbluetooth-backed hosts FAIL this — the upstream
     * SimplebleAdapter singleton overwrites the peripherals Map entry
     * for every readvertising address, including the one we just
     * dialed. Phase 1 (noble migration) fixes this. The mock backend
     * passes because each TestRecordingAdapter is per-peripheral.
     */
    if (backend.case.expectedFailures?.includes('rescan')) {
      it.fails(
        're-scan does not invalidate an open peripheral (KNOWN: webbluetooth singleton bug; Phase 1)',
        async () => {
          await runReScanInvariant(fixture);
        }
      );
    } else {
      it('re-scan does not invalidate an open peripheral', async () => {
        await runReScanInvariant(fixture);
      });
    }

    it('peripheral.status flips to `lost` when the underlying adapter drops', async () => {
      const [discA] = await fixture.host.scan({ timeout: 10 });
      const pA = await fixture.host.dial(discA);
      expect(pA.status).toBe('connected');

      const adapterA = unwrapAdapter(pA);
      // Trigger an unexpected adapter-level disconnect (simulates
      // `gattserverdisconnected` firing without a prior client.disconnect).
      adapterA.setConnectionStatePublic('disconnected');

      expect(pA.status).toBe('lost');
    });

    it('peripheral.write throws after status === lost', async () => {
      const [discA] = await fixture.host.scan({ timeout: 10 });
      const pA = await fixture.host.dial(discA);
      const adapterA = unwrapAdapter(pA);
      adapterA.setConnectionStatePublic('disconnected');
      expect(pA.status).toBe('lost');

      await expect(pA.write(new Uint8Array([0xff]))).rejects.toThrow();
    });

    it('peripheral.disconnect transitions status to disconnected (not lost)', async () => {
      const [discA] = await fixture.host.scan({ timeout: 10 });
      const pA = await fixture.host.dial(discA);
      const events: string[] = [];
      pA.onStatusChange((s) => events.push(s));

      await pA.disconnect();

      expect(pA.status).toBe('disconnected');
      expect(events).toContain('disconnecting');
      expect(events).toContain('disconnected');
      expect(events).not.toContain('lost');
    });
  });
}

// =============================================================================
// Phase 0 PeripheralRebound — runtime cross-talk catch.
//
// Targets the upstream `webbluetooth` SimplebleAdapter cross-talk bug AT THE
// WRITE SITE. The current `LegacyAdapterPeripheral` does not yet have a
// runtime-id-check hook (it would need cooperation from the underlying
// adapter to expose its bound device id). For now we exercise the assertion
// directly against the `PeripheralRebound` error class so consumers building
// non-legacy hosts have a concrete shape to throw.
//
// Hardware-only: the actual SimplebleAdapter peripheral-rebound only happens
// against real BLE devices via the upstream library; we cannot cleanly
// reproduce it in CI without rewriting webbluetooth's internals. Phase 1's
// noble-backed peripheral will add the runtime id-check (each NoblePeripheral
// holds a `noble.Peripheral` reference whose `.id` is observable per-instance)
// and re-enable this test against the new backend.
// =============================================================================

describe('PeripheralRebound — typed error contract', () => {
  it('carries expected vs observed ids and a clear message', () => {
    const err = new PeripheralRebound('expected-a', 'rebound-b');
    expect(err.name).toBe('PeripheralRebound');
    expect(err.expectedId).toBe('expected-a');
    expect(err.observedId).toBe('rebound-b');
    expect(err.message).toMatch(/expected-a/);
    expect(err.message).toMatch(/rebound-b/);
  });

  // Skipped because the upstream webbluetooth cross-talk only surfaces
  // against real hardware via the SimpleBLE C++ binding. The MockHost
  // path has no peripherals Map to corrupt. Phase 1's noble-backed
  // peripheral will be exercised here once landed.
  it.skip('noble-backed peripheral.write() throws PeripheralRebound when underlying handle is rebound (HARDWARE)', () => {
    // To be implemented alongside the noble backend in Phase 1.
  });
});

// =============================================================================
// Real MockBLEAdapter — single-device smoke test against the production
// `MockBLEAdapter` (not the in-test recording fixture). Validates that the
// Phase 0 LegacyAdapterHost shim composes cleanly with the SDK's actual
// mock backend.
// =============================================================================

describe('BluetoothHost contract — real MockBLEAdapter (single-device smoke)', () => {
  it('scan + dial + status transitions work end-to-end', async () => {
    const host = new LegacyAdapterHost(() => new MockBLEAdapter({ connectDelayMs: 0 }));
    try {
      const discoveries = await host.scan({ timeout: 50 });
      expect(discoveries.length).toBe(1);
      const peripheral = await host.dial(discoveries[0]);
      expect(peripheral.status).toBe('connected');

      // Disconnect transitions cleanly through 'disconnecting' -> 'disconnected'
      const states: string[] = [];
      peripheral.onStatusChange((s) => states.push(s));
      await peripheral.disconnect();
      expect(peripheral.status).toBe('disconnected');
      expect(states).toContain('disconnected');
    } finally {
      await host.dispose();
    }
  });
});

// =============================================================================
// Hardware-only tests — explicitly skipped, documented as gaps.
//
// These cases NEED real BLE hardware to exercise the upstream library's
// behavior. They are NOT covered by the in-memory fixture above.
//
// Phase 1 (noble migration) adds a noble-backed contract row that exercises
// the rescan + cross-talk invariants against real-ish library internals
// (noble has a stub mode). Until then this block tracks the gaps.
// =============================================================================

describe('BluetoothHost contract — hardware-only gaps (skipped, documented)', () => {
  it.skip('webbluetooth backend FAILS the rescan invariant on real hardware (Bug: webbluetooth SimplebleAdapter singleton)', async () => {
    // Repro requires: (a) webbluetooth installed, (b) two real Voltras
    // powered on. The second scan rebinds the SimplebleAdapter
    // peripherals Map for VTR-A while client_A still holds an open
    // writeChar — subsequent writes to client_A then route to VTR-B.
    // Phase 1 migrates to @stoprocent/noble to fix this at the library
    // layer.
  });

  it.skip('native (react-native-ble-plx) backend rescan invariant (Android device required)', async () => {
    // Needs a connected Android device + running app. Native BLE adapter
    // path is mostly Phase-0-correct: it's a per-instance BleManager
    // wrapper, not a process singleton, so cross-talk is library-level
    // safe. This case validates the contract end-to-end.
  });

  it.skip('PeripheralRebound runtime catch on webbluetooth cross-talk (HARDWARE)', async () => {
    // To be implemented in Phase 1 alongside the noble peripheral. The
    // current LegacyAdapterPeripheral does not yet have a runtime-id-
    // check hook (it would need cooperation from the underlying
    // adapter to expose its bound device id). PeripheralRebound's
    // typed-error contract is exercised in unit form above; the
    // hardware case is the runtime catch.
  });
});

// =============================================================================
// Helpers
// =============================================================================

async function runReScanInvariant(fixture: BackendFixture): Promise<void> {
  const [discA] = await fixture.host.scan({ timeout: 10 });
  const pA = await fixture.host.dial(discA);
  expect(pA.status).toBe('connected');

  // Run another scan. On the legacy webbluetooth backend this would
  // overwrite the SimplebleAdapter peripherals Map entry for VTR-A.
  // On Mock + future noble each peripheral keeps its own handle.
  await fixture.host.scan({ timeout: 10 });

  expect(pA.status).toBe('connected');

  // And writes still land on A's adapter, not anywhere else.
  const adapterA = unwrapAdapter(pA);
  await pA.write(new Uint8Array([0xc0, 0xff, 0xee]));
  expect(adapterA.writes.length).toBeGreaterThan(0);
  await pA.disconnect();
}

/**
 * Reach into a `LegacyAdapterPeripheral` and return its TestRecordingAdapter.
 * Encapsulates the cast so the rest of the suite stays readable.
 */
function unwrapAdapter(peripheral: Peripheral): TestRecordingAdapter {
  if (peripheral instanceof LegacyAdapterPeripheral) {
    return peripheral.adapter as TestRecordingAdapter;
  }
  throw new Error(
    'unwrapAdapter: peripheral is not a LegacyAdapterPeripheral; ' +
      'extend the helper for new backends as they land'
  );
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// =============================================================================
// Patch: expose `setConnectionState` on TestRecordingAdapter so tests can
// drive disconnect events. Re-uses the protected method on BaseBLEAdapter.
// =============================================================================

declare module './host-contract.test.helpers' {
  // Empty — typing-only namespace for module augmentation if needed.
}

interface PublicTestRecordingAdapter extends TestRecordingAdapter {
  setConnectionStatePublic: (
    state: 'connecting' | 'connected' | 'disconnecting' | 'disconnected'
  ) => void;
}

// Augment the prototype once with a public hook. Done here (not in the
// fixture class itself) so production code stays free of test helpers.
(TestRecordingAdapter.prototype as PublicTestRecordingAdapter).setConnectionStatePublic = function (
  this: TestRecordingAdapter,
  state: 'connecting' | 'connected' | 'disconnecting' | 'disconnected'
): void {
  // BaseBLEAdapter's `setConnectionState` is protected; call through a
  // local cast so test fixtures don't need their own subclass.
  (this as unknown as { setConnectionState: (s: typeof state) => void }).setConnectionState(state);
};

// Suppress unused warnings for imported types referenced only in JSDoc.
void [
  null as unknown as BLEAdapter,
  null as unknown as ConnectionStateCallback,
  null as unknown as NotificationCallback,
];
