/**
 * NobleHost + NoblePeripheral — Phase 1 Node BLE backend (2026-05-08).
 *
 * Direct implementation of `BluetoothHost` + `Peripheral` (the Phase 0
 * interfaces) against `@stoprocent/noble` 2.5.x. Does NOT implement the
 * legacy `BLEAdapter` shim — Phase 1's whole point is to offer a Node
 * backend that is multi-peripheral-safe at the library layer, fixing the
 * upstream `webbluetooth` `SimplebleAdapter` singleton cross-talk bug
 * (see `coordination/bug-investigations/sdk-fresh-connect-cross-talk-2026-05-08.md`).
 *
 * Ships as `platform: 'node-noble'` opt-in. The default `'node'` platform
 * remains on `webbluetooth` until Phase 4 promotes this backend.
 *
 * Design:
 *   - `NobleHost` owns the `Noble` singleton (one per process), drives
 *     scan + dial, and produces `Peripheral` handles whose lifetimes are
 *     fully independent. Multiple in-flight peripherals are first-class.
 *   - `NoblePeripheral` carries its own `noble.Peripheral` reference. The
 *     status enum is the single truth — `connecting | connected |
 *     disconnecting | disconnected | lost`. Driven by both explicit
 *     lifecycle calls and noble's `'disconnect'` event.
 *   - `PeripheralRebound` runtime check fires on every write: if the
 *     cached underlying peripheral's `.id` ever diverges from the
 *     declared `id`, throw before issuing the write so on-device damage
 *     is avoided. Backstop for any future library-layer rebind.
 *
 * macOS caveat per research doc §4d: noble auto-negotiates MTU 185–244
 * via CoreBluetooth. The largest Voltra payload is ~52B (the `aa 80 25`
 * envelope), so no `requestMtu()` call is needed. Linux HCI may differ;
 * not exercised here.
 *
 * See: coordination/bug-investigations/ble-library-migration-research-2026-05-08.md
 *      coordination/architecture/ble-adapter-refactor-2026-05-08.md
 */

import type {
  BLEServiceConfig,
  BluetoothHost,
  ConnectOptions,
  Discovery,
  HostScanOptions,
  NotificationCallback,
  Peripheral,
  PeripheralStatus,
  PeripheralStatusCallback,
  PeripheralWriteOptions,
} from './types';
import { PeripheralLost, PeripheralRebound } from './types';
import { createLogger } from '../../shared/logger';

const log = createLogger('NobleHost');

// =============================================================================
// noble module typing — kept narrow + library-agnostic so importing this
// file does NOT eagerly require `@stoprocent/noble`. The actual module is
// resolved via a dynamic import inside `ensureNobleLoaded()`.
// =============================================================================

/** Subset of `@stoprocent/noble`'s `Peripheral` we use. */
export interface NoblePeripheralLike {
  readonly id: string;
  readonly address: string;
  readonly advertisement: { localName?: string };
  readonly rssi: number;
  readonly state: 'error' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected';
  connectAsync(): Promise<void>;
  disconnectAsync(): Promise<void>;
  discoverSomeServicesAndCharacteristicsAsync(
    serviceUUIDs: string[],
    characteristicUUIDs: string[]
  ): Promise<{
    services: unknown[];
    characteristics: NobleCharacteristicLike[];
  }>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** Subset of `@stoprocent/noble`'s `Characteristic` we use. */
export interface NobleCharacteristicLike {
  readonly uuid: string;
  readonly properties: string[];
  writeAsync(data: Buffer, withoutResponse: boolean): Promise<void>;
  subscribeAsync(): Promise<void>;
  unsubscribeAsync(): Promise<void>;
  on(event: 'data', listener: (data: Buffer, isNotification: boolean) => void): unknown;
  removeListener(event: 'data', listener: (data: Buffer, isNotification: boolean) => void): unknown;
}

/** Subset of `@stoprocent/noble`'s `Noble` (singleton-ish) we use. */
export interface NobleLike {
  readonly state: string;
  waitForPoweredOnAsync(timeout?: number): Promise<void>;
  startScanningAsync(serviceUUIDs?: string[], allowDuplicates?: boolean): Promise<void>;
  stopScanningAsync(): Promise<void>;
  discoverAsync(): AsyncGenerator<NoblePeripheralLike, void, unknown>;
  reset(): void;
  stop(): void;
}

/** Bindings type accepted by `withBindings()`. */
export type NobleBindingType = 'default' | 'hci' | 'mac' | 'win';

/**
 * Module shape we resolve dynamically — kept structural so tests can
 * `vi.mock('@stoprocent/noble', ...)` without depending on the real
 * package's exports.
 */
interface NobleModuleLike {
  withBindings(bindingType?: NobleBindingType, options?: unknown): NobleLike;
}

/**
 * Cached module loader. Set in tests via `__setNobleModuleForTesting()` to
 * bypass dynamic import; otherwise `ensureNobleLoaded()` does a real
 * `import('@stoprocent/noble')`.
 */
let cachedNobleModule: NobleModuleLike | null = null;

/**
 * Test-only: inject a mock noble module so unit tests can exercise the
 * host/peripheral code without the real `@stoprocent/noble` native
 * bindings. Production code MUST NOT call this — it's purely a hatch
 * for `vi.mock`-style tests.
 *
 * Pass `null` to clear (forces the next call to do a real dynamic import).
 */
export function __setNobleModuleForTesting(mod: NobleModuleLike | null): void {
  cachedNobleModule = mod;
}

async function ensureNobleLoaded(): Promise<NobleModuleLike> {
  if (cachedNobleModule) return cachedNobleModule;
  try {
    const mod = (await import('@stoprocent/noble')) as unknown as NobleModuleLike;
    cachedNobleModule = mod;
    return mod;
  } catch {
    throw new Error(
      '@stoprocent/noble package not found. Install with: npm install --save-optional @stoprocent/noble'
    );
  }
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for the noble-backed host.
 */
export interface NobleHostConfig {
  /** BLE service configuration (UUIDs + name prefix). */
  ble: BLEServiceConfig;
  /**
   * noble bindings flavor. Defaults to `'default'` which auto-selects
   * (`mac` / `hci` / `win`). Override only if you need to force a specific
   * native backend in tests / specialized environments.
   */
  bindings?: NobleBindingType;
  /**
   * Default timeout (ms) for `host.scan()` calls when no explicit
   * `options.timeout` is provided. Mirrors the SDK-layer default.
   */
  defaultScanTimeoutMs?: number;
  /**
   * Timeout (ms) for `host.isAvailable()` to wait for the BLE adapter to
   * power on. Returns `false` after this elapses without a `'poweredOn'`
   * state. Default 1500ms.
   */
  availabilityTimeoutMs?: number;
}

const DEFAULT_SCAN_TIMEOUT_MS = 10_000;
const DEFAULT_AVAILABILITY_TIMEOUT_MS = 1_500;

// =============================================================================
// Helpers — UUID normalization + characteristic matching
// =============================================================================

/**
 * Normalize a BLE UUID for case-insensitive comparison. noble lower-cases
 * and strips dashes; the SDK's protocol constants use upper-case dashed
 * form. Compare both via the same canonical shape.
 */
function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase().replace(/-/g, '');
}

function uuidsEqual(a: string, b: string): boolean {
  return normalizeUuid(a) === normalizeUuid(b);
}

function findCharacteristic(
  characteristics: NobleCharacteristicLike[],
  targetUuid: string
): NobleCharacteristicLike | null {
  return characteristics.find((c) => uuidsEqual(c.uuid, targetUuid)) ?? null;
}

// =============================================================================
// NobleHost — process-level scan + dial entry point
// =============================================================================

/**
 * `BluetoothHost` backed by `@stoprocent/noble`.
 *
 * Lifecycle:
 *   - `noble = withBindings('default')` is lazy-init'd on the first
 *     `scan()` / `isAvailable()` / `dial()` call. Reused across all
 *     subsequent operations on this host.
 *   - `dispose()` stops scanning + clears the cached noble singleton
 *     reference. Does NOT call `noble.stop()` — the underlying singleton
 *     may still be in use by another host or by direct consumers.
 *
 * Multi-peripheral safety:
 *   - Each `dial()` returns a fresh `NoblePeripheral` carrying its own
 *     `noble.Peripheral` reference. noble's `Peripheral` class holds
 *     per-instance state (`this.state`, `this.services`, `this.mtu`),
 *     so two peripherals cannot share state by construction.
 *   - The `_origin` runtime check in `dial()` rejects discoveries from
 *     other hosts (cross-host misuse).
 */
export class NobleHost implements BluetoothHost {
  private readonly config: BLEServiceConfig;
  private readonly bindings: NobleBindingType;
  private readonly defaultScanTimeoutMs: number;
  private readonly availabilityTimeoutMs: number;

  /**
   * Cached noble singleton. Populated on first scan/availability/dial.
   * Cleared on `dispose()`.
   */
  private noble: NobleLike | null = null;

  /**
   * Cache of last-scan peripherals keyed by id. The `_payload` of each
   * `Discovery` we hand out points back into this map so `dial()` can
   * grab the underlying noble.Peripheral without re-scanning.
   */
  private discoveredPeripherals: Map<string, NoblePeripheralLike> = new Map();

  /**
   * Indicates a scan is in flight. Used to reject overlapping scans
   * (noble allows only one scan window at a time per binding).
   */
  private scanning = false;

  private disposed = false;

  constructor(config: NobleHostConfig) {
    this.config = config.ble;
    this.bindings = config.bindings ?? 'default';
    this.defaultScanTimeoutMs = config.defaultScanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
    this.availabilityTimeoutMs = config.availabilityTimeoutMs ?? DEFAULT_AVAILABILITY_TIMEOUT_MS;
  }

  /**
   * Lazy-initialize and return the noble singleton bound to this host's
   * configured bindings flavor.
   */
  private async getNoble(): Promise<NobleLike> {
    if (this.noble) return this.noble;
    const mod = await ensureNobleLoaded();
    this.noble = mod.withBindings(this.bindings);
    return this.noble;
  }

  async scan(options: HostScanOptions = {}): Promise<Discovery[]> {
    this.ensureNotDisposed();
    if (this.scanning) {
      throw new Error('NobleHost.scan(): a scan is already in progress on this host');
    }

    const timeout = options.timeout ?? this.defaultScanTimeoutMs;
    const namePrefix = options.deviceNamePrefix ?? this.config.deviceNamePrefix;

    const noble = await this.getNoble();
    await noble.waitForPoweredOnAsync(this.availabilityTimeoutMs);

    this.scanning = true;
    const discoveries: Discovery[] = [];
    const seen = new Set<string>();

    try {
      // Filter at the BLE-stack level by service UUID — fewer events on
      // the wire. The name-prefix filter happens in JS as a second pass.
      await noble.startScanningAsync([this.config.serviceUUID], false);

      const deadline = Date.now() + timeout;
      const iterator = noble.discoverAsync();
      const next = async (): Promise<NoblePeripheralLike | null> => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        // Race the async iterator against the deadline.
        const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining));
        const result = await Promise.race([
          iterator.next().then((r) => (r.done ? null : r.value)),
          timer,
        ]);
        return result;
      };

      let peripheral: NoblePeripheralLike | null;
      while ((peripheral = await next()) !== null) {
        if (Date.now() >= deadline) break;
        if (seen.has(peripheral.id)) continue;

        const name = peripheral.advertisement.localName ?? null;
        if (namePrefix && !(name?.startsWith(namePrefix) ?? false)) {
          continue;
        }

        seen.add(peripheral.id);
        this.discoveredPeripherals.set(peripheral.id, peripheral);

        const discovery: Discovery = {
          id: peripheral.id,
          name,
          rssi: peripheral.rssi,
          _origin: this,
          _payload: { peripheral },
        };
        discoveries.push(discovery);
      }
    } finally {
      try {
        await noble.stopScanningAsync();
      } catch (e) {
        log.debug('stopScanningAsync threw on cleanup:', e);
      }
      this.scanning = false;
    }

    return discoveries;
  }

  async dial(discovery: Discovery, options?: ConnectOptions): Promise<Peripheral> {
    this.ensureNotDisposed();

    if (discovery._origin !== this) {
      throw new Error(`Discovery was produced by a different host — cannot dial against this host`);
    }

    const payload = discovery._payload as { peripheral: NoblePeripheralLike } | null;
    if (!payload?.peripheral) {
      throw new Error('Discovery payload is missing the noble peripheral reference');
    }

    if (payload.peripheral.id !== discovery.id) {
      // The cached noble.Peripheral does not match the discovery id we
      // promised. Refuse to dial — this is precisely the cross-talk
      // shape Phase 1 is designed to catch.
      throw new PeripheralRebound(
        discovery.id,
        payload.peripheral.id,
        `NobleHost.dial: cached peripheral id=${payload.peripheral.id} does not match discovery id=${discovery.id}`
      );
    }

    const wrapped = new NoblePeripheral(
      payload.peripheral,
      discovery.id,
      discovery.name,
      this.config
    );

    // _dial flips status to 'disconnected' on failure paths and rethrows;
    // we don't need to catch here, the error propagates as-is.
    await wrapped._dial(options);

    return wrapped;
  }

  async isAvailable(): Promise<boolean> {
    if (this.disposed) return false;
    try {
      const noble = await this.getNoble();
      await noble.waitForPoweredOnAsync(this.availabilityTimeoutMs);
      return noble.state === 'poweredOn';
    } catch {
      return false;
    }
  }

  async getKnownDiscoveries(): Promise<Discovery[]> {
    // noble has no persistent-authorization concept on Node — every
    // session must scan. Return empty per the BluetoothHost contract.
    return [];
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.noble && this.scanning) {
      try {
        await this.noble.stopScanningAsync();
      } catch {
        // ignore
      }
    }
    this.noble = null;
    this.discoveredPeripherals.clear();
    this.scanning = false;
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('NobleHost has been disposed');
    }
  }
}

// =============================================================================
// NoblePeripheral — per-device handle
// =============================================================================

/**
 * `Peripheral` backed by a single `@stoprocent/noble` `Peripheral`
 * instance. Carries its own write/notify characteristics, status, and
 * disconnect plumbing.
 *
 * Status drivers:
 *   - `_dial()` flips `connecting -> connected` after services + chars
 *     are discovered + notify subscribed.
 *   - noble's `'disconnect'` event flips `connected -> lost` (or, if a
 *     `disconnect()` call was already in flight, `disconnecting ->
 *     disconnected`).
 *   - Explicit `disconnect()` flips `connected -> disconnecting ->
 *     disconnected`.
 *   - A failed `write()` flips `connected -> lost` and re-throws as
 *     `PeripheralLost`. A rebound underlying handle throws
 *     `PeripheralRebound` first (and DOES NOT mutate status — the
 *     underlying noble.Peripheral may still be alive, just bound to a
 *     different device).
 */
export class NoblePeripheral implements Peripheral {
  readonly id: string;
  readonly name: string | null;

  /**
   * Cached underlying noble.Peripheral reference. Inspected on every
   * write to detect a rebound handle (`PeripheralRebound`).
   *
   * Public-readonly so test fixtures can grab the underlying noble
   * peripheral for direct manipulation; not part of the `Peripheral`
   * interface.
   */
  readonly _underlying: NoblePeripheralLike;

  private readonly bleConfig: BLEServiceConfig;

  private writeChar: NobleCharacteristicLike | null = null;
  private notifyChar: NobleCharacteristicLike | null = null;

  private _status: PeripheralStatus = 'connecting';
  private statusCallbacks: PeripheralStatusCallback[] = [];
  private notificationCallbacks: NotificationCallback[] = [];

  /**
   * Listener bound to noble.Peripheral's `'disconnect'` event. Cached
   * so we can detach in `_teardown()` to avoid leaks.
   */
  private boundDisconnectHandler: ((reason: string) => void) | null = null;

  /**
   * Listener bound to characteristic `'data'` events. Cached for
   * detachment.
   */
  private boundDataHandler: ((data: Buffer, isNotification: boolean) => void) | null = null;

  constructor(
    underlying: NoblePeripheralLike,
    id: string,
    name: string | null,
    bleConfig: BLEServiceConfig
  ) {
    this._underlying = underlying;
    this.id = id;
    this.name = name;
    this.bleConfig = bleConfig;
  }

  get status(): PeripheralStatus {
    return this._status;
  }

  /**
   * Connect, discover the Voltra service + characteristics, subscribe
   * to notifications, and (optionally) issue an immediate-write before
   * flipping to `'connected'`. Used by `NobleHost.dial()`. Internal —
   * not part of the `Peripheral` interface.
   */
  async _dial(options?: ConnectOptions): Promise<void> {
    try {
      // Wire the disconnect listener BEFORE connecting so we don't miss
      // an immediate drop event.
      this.boundDisconnectHandler = (_reason: string) => {
        if (this._status === 'connected' || this._status === 'connecting') {
          this.transition('lost');
        } else if (this._status === 'disconnecting') {
          this.transition('disconnected');
        }
      };
      this._underlying.on(
        'disconnect',
        this.boundDisconnectHandler as (...args: unknown[]) => void
      );

      if (this._underlying.state !== 'connected') {
        await this._underlying.connectAsync();
      }

      const { characteristics } =
        await this._underlying.discoverSomeServicesAndCharacteristicsAsync(
          [this.bleConfig.serviceUUID],
          [this.bleConfig.writeCharUUID, this.bleConfig.notifyCharUUID]
        );

      const writeChar = findCharacteristic(characteristics, this.bleConfig.writeCharUUID);
      const notifyChar = findCharacteristic(characteristics, this.bleConfig.notifyCharUUID);
      if (!writeChar) {
        throw new Error(
          `Write characteristic ${this.bleConfig.writeCharUUID} not found on peripheral ${this.id}`
        );
      }
      if (!notifyChar) {
        throw new Error(
          `Notify characteristic ${this.bleConfig.notifyCharUUID} not found on peripheral ${this.id}`
        );
      }
      this.writeChar = writeChar;
      this.notifyChar = notifyChar;

      this.boundDataHandler = (data: Buffer) => {
        this.emitNotification(new Uint8Array(data));
      };
      notifyChar.on('data', this.boundDataHandler);
      await notifyChar.subscribeAsync();
      // Some Voltra firmware fans out frames on the write char too —
      // mirror the legacy WebBluetoothBase behavior.
      if (writeChar.properties.includes('notify')) {
        writeChar.on('data', this.boundDataHandler);
        await writeChar.subscribeAsync();
      }

      if (options?.immediateWrite) {
        // Direct char write — `this.write()` requires status==='connected'
        // and we haven't transitioned yet. The auth/init protocol expects
        // this byte before the link is fully "ready" from the SDK's
        // perspective.
        await writeChar.writeAsync(Buffer.from(options.immediateWrite), false);
      }

      this.transition('connected');
    } catch (e) {
      // Whatever stage failed, give up cleanly. Status flips to
      // 'disconnected' so callers can distinguish from the unexpected
      // 'lost' path. Best-effort underlying disconnect.
      this._teardown();
      try {
        await this._underlying.disconnectAsync();
      } catch {
        // ignore — we're already failing
      }
      this.transition('disconnected');
      throw e;
    }
  }

  async write(data: Uint8Array, options?: PeripheralWriteOptions): Promise<void> {
    if (this._status !== 'connected') {
      throw new PeripheralLost(this.id, this._status);
    }

    // Phase 0 §6.2 runtime invariant: cross-check the underlying noble
    // peripheral's id BEFORE every write. This catches the upstream
    // cross-talk shape (peripherals Map rebound) at the write site,
    // before the on-device damage. Each noble.Peripheral exposes `.id`
    // per-instance — different from Phase 0's legacy shim, which
    // couldn't see this.
    if (this._underlying.id !== this.id) {
      throw new PeripheralRebound(this.id, this._underlying.id);
    }

    if (!this.writeChar) {
      // Defensive: status said 'connected' but writeChar was nulled.
      // Treat as link-dead.
      this.transition('lost');
      throw new PeripheralLost(this.id, this._status);
    }

    const withResponse = options?.withResponse ?? true;
    try {
      // noble's `writeAsync(data, withoutResponse)` — pass FALSE to
      // request a write-with-response (the default Voltra contract).
      await this.writeChar.writeAsync(Buffer.from(data), !withResponse);
    } catch (e) {
      // Treat any write failure as proof the link is dead. Flip status
      // before re-raising so the SDK reconnect-handler sees a
      // consistent surface.
      this.transition('lost');
      const message = e instanceof Error ? e.message : String(e);
      throw new PeripheralLost(this.id, this._status, `BLE write failed: ${message}`);
    }
  }

  onNotification(callback: NotificationCallback): () => void {
    this.notificationCallbacks.push(callback);
    return () => {
      const idx = this.notificationCallbacks.indexOf(callback);
      if (idx >= 0) this.notificationCallbacks.splice(idx, 1);
    };
  }

  onStatusChange(callback: PeripheralStatusCallback): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      const idx = this.statusCallbacks.indexOf(callback);
      if (idx >= 0) this.statusCallbacks.splice(idx, 1);
    };
  }

  async disconnect(): Promise<void> {
    if (this._status === 'disconnected' || this._status === 'lost') {
      return;
    }
    this.transition('disconnecting');
    try {
      await this._underlying.disconnectAsync();
    } catch (e) {
      log.debug('disconnectAsync threw, continuing teardown:', e);
    }
    this._teardown();
    if (this._status === 'disconnecting') {
      this.transition('disconnected');
    }
  }

  /**
   * Detach all listeners we attached to the underlying noble objects.
   * Idempotent. Called on the success path during `disconnect()`, and
   * on the failure paths during `_dial()`.
   */
  private _teardown(): void {
    if (this.boundDisconnectHandler) {
      try {
        this._underlying.removeListener(
          'disconnect',
          this.boundDisconnectHandler as (...args: unknown[]) => void
        );
      } catch {
        // ignore
      }
      this.boundDisconnectHandler = null;
    }
    if (this.boundDataHandler) {
      try {
        this.notifyChar?.removeListener('data', this.boundDataHandler);
        this.writeChar?.removeListener('data', this.boundDataHandler);
      } catch {
        // ignore
      }
      this.boundDataHandler = null;
    }
    this.writeChar = null;
    this.notifyChar = null;
  }

  private transition(next: PeripheralStatus): void {
    if (this._status === next) return;
    this._status = next;
    for (const cb of [...this.statusCallbacks]) {
      try {
        cb(next);
      } catch (e) {
        log.error('status callback error:', e);
      }
    }
  }

  private emitNotification(data: Uint8Array): void {
    for (const cb of [...this.notificationCallbacks]) {
      try {
        cb(data);
      } catch (e) {
        log.error('notification callback error:', e);
      }
    }
  }
}
