/**
 * VoltraClient
 *
 * High-level API for connecting to and controlling a single Voltra device.
 * Handles connection lifecycle, authentication, device settings, and telemetry.
 *
 * @example
 * ```typescript
 * import { VoltraClient, WebBLEAdapter, BLE } from '@voltras/node-sdk';
 *
 * const adapter = new WebBLEAdapter({ ble: BLE });
 * const client = new VoltraClient({ adapter });
 *
 * // Connect to device
 * const devices = await client.scan();
 * await client.connect(devices[0]);
 *
 * // Configure settings
 * await client.setWeight(50);
 * await client.setMode(TrainingMode.WeightTraining);
 *
 * // Listen for telemetry
 * client.onFrame((frame) => {
 *   console.log('Position:', frame.position, 'Velocity:', frame.velocity);
 * });
 *
 * // Start recording
 * await client.startRecording();
 * // ... workout ...
 * await client.stopRecording();
 *
 * // Cleanup
 * client.dispose();
 * ```
 */

import type { BLEAdapter } from '../bluetooth/adapters/types';
import { PeripheralAdapterBridge } from './peripheral-adapter-bridge';
import type { DiscoveredDevice } from '../bluetooth/models/device';
import type { VoltraConnectionState } from '../voltra/models/connection';
import { DEFAULT_SETTINGS } from '../voltra/models/device';
import type { VoltraDeviceSettings, VoltraRecordingState } from '../voltra/models/device';
import { isValidVoltraTransition } from '../voltra/models/connection';
import { filterVoltraDevices } from '../voltra/models/device-filter';
import { Auth, Init, Timing, Workout } from '../voltra/protocol/constants';
import {
  getWeightCommand,
  getChainsCommand,
  getEccentricCommand,
  getInverseChainsCommand,
  getModeCommand,
  getAvailableWeights as getAvailableWeightValues,
  getAvailableChains as getAvailableChainValues,
  getAvailableEccentric as getAvailableEccentricValues,
  getAvailableInverseChains as getAvailableInverseChainsValues,
  getAvailableModes,
  getDamperLevelCommand,
  getAssistModeCommand,
  getBandMaxForceCommand,
  getIsokineticTargetSpeedCommand,
  getIsokineticEccModeCommand,
  getIsokineticEccSpeedLimitCommand,
  getIsokineticEccConstWeightCommand,
  getIsokineticEccOverloadWeightCommand,
  getAvailableDamperLevels,
  getAvailableBandMaxForce,
  getAvailableIsokineticTargetSpeeds,
  getAvailableIsokineticEccSpeedLimits,
  getAvailableIsokineticEccConstWeights,
  getAvailableIsokineticEccOverloadWeights,
  getTelemetryRateCommand,
  getAvailableTelemetryRates,
  getTelemetrySubscribeCommand,
  getCableTriggerCommand,
  getResistanceExperienceCommand,
} from '../voltra/protocol/commands';
import { TrainingMode } from '../voltra/protocol/constants';
import {
  ROW_START_ACTION_CODES,
  buildRowScrSwitchFrame,
  buildVendorStateRefreshFrame,
} from '../voltra/protocol/rowing-frames';
import { delay } from '../shared/utils';
import { createNotificationHandler } from './notification-dispatcher';
import { setupDisconnectMonitor, attemptReconnect } from './reconnect-handler';
import { ReassertScheduler } from './scheduler';
import {
  ConnectionError,
  AuthenticationError,
  NotConnectedError,
  InvalidSettingError,
  CommandError,
  TimeoutError,
  ErrorCode,
} from '../errors';
import type {
  VoltraClientOptions,
  VoltraClientState,
  VoltraClientEvent,
  VoltraClientEventListener,
  FrameListener,
  RawFrameListener,
  ModeConfirmedListener,
  SettingsUpdateListener,
  StateDumpListener,
  BatteryUpdateListener,
  PerRepListener,
  SummaryListener,
  SetSummaryListener,
  InProgressListener,
  ScanOptions,
  RowingDistancePreset,
  GuidedLoadOptions,
  GuidedLoadState,
  GuidedLoadStateListener,
} from './types';
import type { DeviceSettings } from '../voltra/protocol/types';
import {
  buildGuidedLoadTriggerFrame,
  buildGuidedLoadStatusReadFrame,
  buildGuidedLoadExitFrame,
  decodeGuidedLoadStatus,
  GUIDED_LOAD_MODE_ARMED,
  GUIDED_LOAD_MODE_ACTIVE,
  type GuidedLoadStatusFields,
} from '../voltra/protocol/guided-load';

/**
 * Default client options.
 *
 * `adapter` and `peripheral` are mutually exclusive — both omitted from
 * defaults; the constructor decides which path to take based on which
 * was supplied.
 */
const DEFAULT_OPTIONS: Required<Omit<VoltraClientOptions, 'adapter' | 'peripheral'>> = {
  autoReconnect: false,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
};

/**
 * High-level client for connecting to and controlling a Voltra device.
 */
export class VoltraClient {
  // Options
  private readonly options: Required<Omit<VoltraClientOptions, 'adapter' | 'peripheral'>>;

  // Adapter — legacy path; populated either directly from
  // `options.adapter` or synthesized from `options.peripheral` via the
  // `PeripheralAdapterBridge`. All internal BLE I/O routes through here.
  private adapter: BLEAdapter | null;

  /**
   * Bridge instance when constructed with `{ peripheral }`. Held so
   * `dispose()` can release the peripheral subscriptions and so
   * `unsafeDiagnostics()` can return the underlying typed peripheral.
   */
  private peripheralBridge: PeripheralAdapterBridge | null = null;

  // State
  private _connectionState: VoltraConnectionState = 'disconnected';
  private _connectedDeviceId: string | null = null;
  private _connectedDeviceName: string | null = null;
  private _settings: VoltraDeviceSettings = { ...DEFAULT_SETTINGS };
  private _recordingState: VoltraRecordingState = 'idle';
  private _isReconnecting = false;
  private _reconnectAttempt = 0;
  private _error: Error | null = null;
  private _lastConnectedDevice: DiscoveredDevice | null = null;

  // Notification handling
  private notificationUnsubscribe: (() => void) | null = null;

  // Event listeners
  private listeners: Set<VoltraClientEventListener> = new Set();
  private frameListeners: Set<FrameListener> = new Set();
  private rawFrameListeners: Set<RawFrameListener> = new Set();
  private perRepListeners: Set<PerRepListener> = new Set();
  private summaryListeners: Set<SummaryListener> = new Set();
  private setSummaryListeners: Set<SetSummaryListener> = new Set();
  private inProgressListeners: Set<InProgressListener> = new Set();
  private modeConfirmedListeners: Set<ModeConfirmedListener> = new Set();
  private settingsUpdateListeners: Set<SettingsUpdateListener> = new Set();
  private stateDumpListeners: Set<StateDumpListener> = new Set();
  private batteryUpdateListeners: Set<BatteryUpdateListener> = new Set();
  private guidedLoadStateListeners: Set<GuidedLoadStateListener> = new Set();

  // Guided-load state machine (Phase 1g, @experimental)
  private _guidedLoadActive = false;
  private _guidedLoadState: GuidedLoadState = {
    phase: 'idle',
    countdownRemainingMs: null,
    fitnessModeRaw: null,
  };
  private guidedLoadPollTimer: ReturnType<typeof setInterval> | null = null;
  private guidedLoadEndTimer: ReturnType<typeof setTimeout> | null = null;

  // <Bug-22> Rowing two-stage entry state
  /** Whether `enterRowMode()` has run since the last cleanup() / setMode(). */
  private _rowSubMenuOpen = false;
  /**
   * Whether `startRow()` has run since the last cleanup() / setMode(). The
   * SDK can't yet decode confirmation frames, so this flag reflects
   * "command issued" rather than "device confirmed live."
   */
  private _rowStarted = false;
  private readonly rowReassertScheduler = new ReassertScheduler();
  // </Bug-22>

  // Bootstrap-replay buffer: caches the most recent settings cascade so a
  // listener attached AFTER `connect()` resolves still sees the bootstrap
  // settings. Cleared in `cleanup()`. Added 0.6.2 to fix the bridge-bootstrap
  // timing window where consumers can't realistically attach listeners
  // synchronously inside connect().
  private _lastDeviceSettings: DeviceSettings | null = null;

  // Disposed flag
  private disposed = false;

  constructor(options: VoltraClientOptions = {}) {
    if (options.adapter && options.peripheral) {
      throw new Error(
        'VoltraClient: pass `adapter` OR `peripheral`, not both. ' +
          'The peripheral path supersedes the adapter path.'
      );
    }
    this.options = { ...DEFAULT_OPTIONS, ...options };

    if (options.peripheral) {
      // New Phase 0 path: drive through a Peripheral. The bridge
      // adapts to the legacy BLEAdapter shape so the rest of
      // VoltraClient is unchanged.
      this.peripheralBridge = new PeripheralAdapterBridge(options.peripheral);
      this.adapter = this.peripheralBridge;
    } else {
      this.adapter = options.adapter ?? null;
    }
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  /**
   * Get current connection state.
   */
  get connectionState(): VoltraConnectionState {
    return this._connectionState;
  }

  /**
   * Check if connected to a device.
   */
  get isConnected(): boolean {
    return this._connectionState === 'connected';
  }

  /**
   * Check if currently reconnecting.
   */
  get isReconnecting(): boolean {
    return this._isReconnecting;
  }

  /**
   * Get connected device ID.
   */
  get connectedDeviceId(): string | null {
    return this._connectedDeviceId;
  }

  /**
   * Get connected device name.
   */
  get connectedDeviceName(): string | null {
    return this._connectedDeviceName;
  }

  /**
   * Get current device settings.
   */
  get settings(): VoltraDeviceSettings {
    return { ...this._settings };
  }

  /**
   * Get current recording state.
   */
  get recordingState(): VoltraRecordingState {
    return this._recordingState;
  }

  /**
   * Check if currently recording.
   */
  get isRecording(): boolean {
    return this._recordingState === 'active';
  }

  /**
   * Get last error.
   */
  get error(): Error | null {
    return this._error;
  }

  /**
   * Get full state snapshot.
   */
  get state(): VoltraClientState {
    return {
      connectionState: this._connectionState,
      isConnected: this.isConnected,
      isReconnecting: this._isReconnecting,
      connectedDeviceId: this._connectedDeviceId,
      connectedDeviceName: this._connectedDeviceName,
      settings: { ...this._settings },
      recordingState: this._recordingState,
      isRecording: this.isRecording,
      error: this._error,
    };
  }

  // ===========================================================================
  // Adapter Management
  // ===========================================================================

  /**
   * Set the BLE adapter to use.
   * Must be called before connect() if not provided in constructor.
   */
  setAdapter(adapter: BLEAdapter): void {
    this.ensureNotDisposed();
    if (this.isConnected) {
      throw new Error('Cannot change adapter while connected');
    }
    this.adapter = adapter;
  }

  /**
   * Get the current adapter.
   *
   * When the client is backed by a `Peripheral` (Phase 0+), this
   * returns the underlying legacy `BLEAdapter` if the peripheral was
   * built via the `LegacyAdapterPeripheral` shim — preserving backward
   * compatibility with mock-debug callers + test assertions that expect
   * the concrete adapter back. For peripherals from a non-legacy host
   * (e.g. a future noble-backed host), this returns the
   * `PeripheralAdapterBridge` itself, which still implements the full
   * `BLEAdapter` interface.
   */
  getAdapter(): BLEAdapter | null {
    if (this.peripheralBridge) {
      // Try to unwrap to the legacy adapter inside a LegacyAdapterPeripheral.
      const peripheral = this.peripheralBridge.peripheral as {
        adapter?: BLEAdapter;
      };
      if (peripheral.adapter) {
        return peripheral.adapter;
      }
      return this.peripheralBridge;
    }
    return this.adapter;
  }

  /**
   * Diagnostic byte-pipe accessor.
   *
   * Returns a narrowed surface for raw BLE writes + matched-response
   * collection. Used by tooling (voltras-mcp's `device.send_raw`,
   * protocol-byte sweeps, ad-hoc reverse engineering) that needs to send
   * a hand-built frame and observe the next inbound bytes.
   *
   * The deliberately-ugly name (`unsafeDiagnostics`) keeps it out of the
   * typical autocomplete path. Audit logging, command-allowlisting, and
   * mock-adapter rejection remain a CONSUMER concern (e.g. mcp). The SDK
   * surface here only owns:
   * - Single point of truth for "where does the byte go?" — uses the
   *   underlying `Peripheral.write()` (or legacy adapter `write()`),
   *   which catches `PeripheralLost` and flips the client to
   *   disconnected via the same path as `writeFrame()`.
   * - Listener attach/detach for response collection — the consumer
   *   passes a callback; we wire it through `adapter.onNotification`
   *   and return an unsubscribe.
   *
   * Throws `NotConnectedError` if the client is not connected. Callers
   * are responsible for any timing, audit, or matching logic.
   *
   * Returns `null` if the client has no adapter configured (constructor
   * was called without `adapter` or `peripheral`).
   */
  unsafeDiagnostics(): {
    write: (data: Uint8Array, options?: { withResponse?: boolean }) => Promise<void>;
    onResponse: (callback: (data: Uint8Array) => void) => () => void;
  } | null {
    if (!this.adapter) {
      return null;
    }
    const adapter = this.adapter;
    return {
      write: async (data, _options) => {
        // Run through ensureConnected so a half-dead link surfaces the
        // same `CONNECTION_LOST` error that the typed setters do —
        // diagnostic writers see consistent semantics with the rest of
        // the SDK.
        this.ensureConnected();
        try {
          await adapter.write(data);
        } catch (e) {
          // Mirror writeFrame's flip-to-disconnected + rethrow-as-
          // ConnectionError contract. The typed surface and the raw
          // surface both need to agree on what a failed write means
          // for the link.
          this.flipToDisconnected();
          const cause = e instanceof Error ? e : undefined;
          throw new ConnectionError(
            `BLE diagnostic write failed — link is functionally dead, reconnect required: ${this.getErrorMessage(e)}`,
            ErrorCode.CONNECTION_LOST,
            cause
          );
        }
      },
      onResponse: (callback) => adapter.onNotification(callback),
    };
  }

  // ===========================================================================
  // Discovery
  // ===========================================================================

  /**
   * Scan for Voltra devices.
   *
   * Note: In browser environments, this triggers the Web Bluetooth device picker.
   * The returned array will contain only the user-selected device.
   *
   * @param options Scan options
   * @returns Array of discovered Voltra devices
   */
  async scan(options: ScanOptions = {}): Promise<DiscoveredDevice[]> {
    this.ensureNotDisposed();
    this.ensureAdapter();

    if (this.peripheralBridge) {
      throw new Error(
        'VoltraClient.scan() is not supported when constructed with a `peripheral`. ' +
          'Use BluetoothHost.scan() at the host layer instead.'
      );
    }

    const { timeout = 10000, filterVoltra = true } = options;

    const devices = await this.adapter!.scan(timeout);
    return filterVoltra ? filterVoltraDevices(devices) : devices;
  }

  // ===========================================================================
  // Connection
  // ===========================================================================

  /**
   * Connect to a Voltra device.
   * Handles BLE connection, authentication, and initialization.
   *
   * @param device Device to connect to
   */
  async connect(device: DiscoveredDevice): Promise<void> {
    this.ensureNotDisposed();
    this.ensureAdapter();

    if (this.isConnected) {
      throw new ConnectionError('Already connected to a device', ErrorCode.ALREADY_CONNECTED);
    }

    this._error = null;
    this._lastConnectedDevice = device;

    try {
      // Connect. When backed by a pre-dialed Peripheral, the BLE-level
      // dial has already happened at the host layer — skip the legacy
      // adapter.connect() call (which is a no-op anyway through the
      // bridge but throws on unexpected status). Auth + init still run.
      this.setConnectionState('connecting');
      if (!this.peripheralBridge) {
        await this.adapter!.connect(device.id);
      }

      // Setup notification handler before auth
      this.setupNotificationHandler();

      // Authenticate
      this.setConnectionState('authenticating');
      await this.authenticate();

      // Initialize
      await this.initialize();

      // Success
      this._connectedDeviceId = device.id;
      this._connectedDeviceName = device.name ?? null;
      // Bug 17 fix: do NOT blanket-reset `_settings` here. The bootstrap
      // step-10 query (`MODE_FEATURE_STATE_18PARAM_QUERY_HEX`) sent inside
      // `initialize()` triggers a `cmd=0x0F` response that populates
      // `_settings` via `syncSettingsFromDevice`. Resetting _settings here
      // would wipe whatever step-10 just populated. On the disconnect side,
      // `cleanup()` also no longer resets, so last-known settings persist
      // across reconnect until step-10 refreshes them.
      this.setConnectionState('connected');

      this.emit({ type: 'connected', deviceId: device.id, deviceName: device.name ?? null });

      // Setup disconnect handler for auto-reconnect
      this.setupDisconnectHandler();
    } catch (e) {
      this.cleanup();
      this.setConnectionState('disconnected');

      const error = this.wrapError(e, 'Connection failed');
      this._error = error;
      this.emit({ type: 'error', error });
      throw error;
    }
  }

  /**
   * Disconnect from the current device.
   */
  async disconnect(): Promise<void> {
    if (!this._connectedDeviceId) {
      return;
    }

    const deviceId = this._connectedDeviceId;

    try {
      // Stop recording if active
      if (this._recordingState !== 'idle') {
        await this.stopRecording().catch(() => {});
      }

      await this.adapter?.disconnect();
    } catch (e) {
      console.warn('[VoltraClient] Disconnect error:', e);
    }

    this.cleanup();
    this.setConnectionState('disconnected');
    this.emit({ type: 'disconnected', deviceId });
  }

  // ===========================================================================
  // Device Settings
  // ===========================================================================

  /**
   * Set weight in pounds.
   *
   * @param lbs Weight (5-200, any integer value)
   */
  async setWeight(lbs: number): Promise<void> {
    this.ensureConnected();

    const cmd = getWeightCommand(lbs);
    if (!cmd) {
      throw new InvalidSettingError('weight', lbs, getAvailableWeightValues());
    }

    try {
      await this.writeFrame(cmd);
      this._settings.weight = lbs;
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(`Failed to set weight: ${this.getErrorMessage(e)}`, 'setWeight');
    }
  }

  /**
   * Set chains (reverse resistance) in pounds.
   *
   * @param lbs Chains weight (0-100)
   */
  async setChains(lbs: number): Promise<void> {
    this.ensureConnected();

    const cmd = getChainsCommand(lbs);
    if (!cmd) {
      throw new InvalidSettingError('chains', lbs, getAvailableChainValues());
    }

    try {
      await this.writeFrame(cmd);
      this._settings.chains = lbs;
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(`Failed to set chains: ${this.getErrorMessage(e)}`, 'setChains');
    }
  }

  /**
   * Set inverse chains weight.
   *
   * Inverse chains reduce resistance during the concentric (lifting) phase
   * and add resistance during the eccentric (lowering) phase - opposite of regular chains.
   *
   * @param lbs Inverse chains weight in pounds (0-100)
   */
  async setInverseChains(lbs: number): Promise<void> {
    this.ensureConnected();

    const cmd = getInverseChainsCommand(lbs);
    if (!cmd) {
      throw new InvalidSettingError('inverseChains', lbs, getAvailableInverseChainsValues());
    }

    try {
      await this.writeFrame(cmd);
      this._settings.inverseChains = lbs;
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set inverse chains: ${this.getErrorMessage(e)}`,
        'setInverseChains'
      );
    }
  }

  /**
   * Set eccentric load adjustment.
   *
   * @param percent Eccentric adjustment (-195 to +195)
   */
  async setEccentric(percent: number): Promise<void> {
    this.ensureConnected();

    const cmd = getEccentricCommand(percent);
    if (!cmd) {
      throw new InvalidSettingError('eccentric', percent, getAvailableEccentricValues());
    }

    try {
      await this.writeFrame(cmd);
      this._settings.eccentric = percent;
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(`Failed to set eccentric: ${this.getErrorMessage(e)}`, 'setEccentric');
    }
  }

  /**
   * Get available weight values.
   */
  getAvailableWeights(): number[] {
    return getAvailableWeightValues();
  }

  /**
   * Get available chains values.
   */
  getAvailableChains(): number[] {
    return getAvailableChainValues();
  }

  /**
   * Get available eccentric values.
   */
  getAvailableEccentric(): number[] {
    return getAvailableEccentricValues();
  }

  /**
   * Get available inverse chains values.
   */
  getAvailableInverseChains(): number[] {
    return getAvailableInverseChainsValues();
  }

  /**
   * Set training mode.
   *
   * **Rowing is special**: it auto-routes to the two-stage
   * {@link enterRowMode} + {@link startRow} (Just Row, no preset)
   * sequence. Advanced callers who need a distance preset should call
   * the two primitives directly.
   *
   * Bug 22 rationale: Rowing is the only `FITNESS_WORKOUT_STATE`
   * (`0x4FB0 = 3`) that does not respond to the strength-arm primitive
   * (`BP_SET_FITNESS_MODE = 5`). Writing the strength-arm while the
   * device is on the rowing screen is silently reinterpreted as a
   * strength session, reverting the rowing flow — HIGH safety severity.
   * The two-stage path commits via `EP_SCR_SWITCH` action codes, which
   * is the only correct primitive for Rowing.
   *
   * @param mode Training mode to set
   */
  async setMode(mode: TrainingMode): Promise<void> {
    this.ensureConnected();

    // <Bug-22> Auto-route Rowing to the two-stage entry — never the
    // strength-arm. Default to Just Row; advanced callers that need a
    // distance preset must use enterRowMode() + startRow(distance) directly.
    if (mode === TrainingMode.Rowing) {
      await this.enterRowMode();
      await this.startRow();
      return;
    }

    // Reset rowing state if user is moving to a non-Rowing mode.
    this.rowReassertScheduler.cancel();
    this._rowSubMenuOpen = false;
    this._rowStarted = false;
    // </Bug-22>

    const cmd = getModeCommand(mode);
    if (!cmd) {
      throw new InvalidSettingError('mode', mode, getAvailableModes());
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(`Failed to set mode: ${this.getErrorMessage(e)}`, 'setMode');
    }
  }

  // <Bug-22>
  // ===========================================================================
  // Rowing Two-Stage Entry (Bug 22)
  // ===========================================================================
  //
  // Rowing commits via `EP_SCR_SWITCH (0x5165)` followed by a vendor
  // state-refresh pulse (`0xAA 0x13 0x01`), NOT via the strength-mode GO
  // (`BP_SET_FITNESS_MODE ← 5`). The original SDK's `setMode(Rowing)` +
  // `startRecording()` flow silently issued the strength-mode GO during
  // session_start, which caused the device to revert out of rowing mid-
  // session — Bug 22, HIGH safety severity.
  //
  // The new two-stage API is:
  //
  //   await client.enterRowMode();          // opens Just-Row / Distance menu
  //   await client.startRow();              // commits Just-Row (no preset)
  //   // -- or --
  //   await client.startRow('M500');        // commits 500 m preset
  //
  // Wire-level rationale and the action-code table live in
  // voltra-private/research/rowing-protocol-2026-05-06-android-deep.md.

  /**
   * Stage 1 of Rowing entry — open the rowing sub-menu (Just Row /
   * Distance presets) without engaging resistance.
   *
   * Sends the existing `BP_SET_FITNESS_MODE ← 0x0003` (a.k.a.
   * `FITNESS_WORKOUT_STATE = ROWING`) frame. After this returns
   * successfully the device is on the rowing screen but `BP_SET_FITNESS_MODE`
   * still reads `0x0004` (READY); the cable must NOT engage. Call
   * {@link startRow} to commit into a live rowing session.
   *
   * Idempotent — calling repeatedly is safe.
   */
  async enterRowMode(): Promise<void> {
    this.ensureConnected();

    const cmd = getModeCommand(TrainingMode.Rowing);
    if (!cmd) {
      throw new CommandError('Rowing mode command not available in protocol data', 'enterRowMode');
    }

    try {
      await this.writeFrame(cmd);
      this._rowSubMenuOpen = true;
      this._rowStarted = false;
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to enter row mode: ${this.getErrorMessage(e)}`,
        'enterRowMode'
      );
    }
  }

  /**
   * Stage 2 of Rowing entry — commit into a live rowing session.
   *
   * Writes `EP_SCR_SWITCH ← <action> 3E 00 01` (action picks the preset
   * screen) followed by the `0xAA 0x13 0x01` vendor state-refresh pulse.
   * Schedules three reassert ticks at +750 / +1750 / +3000 ms (matching
   * the Android cadence) to recover from BLE-flake drops where the device
   * silently fails to enter rowing-active.
   *
   * Successful commit (verified externally — the SDK does not yet decode
   * the confirmation frames):
   *   - `BP_SET_FITNESS_MODE → 0x0015` (FITNESS_MODE_ROWING_ACTIVE)
   *   - `APP_CUR_SCR_ID → 0x3E`
   *   - `FITNESS_ONGOING_UI → 0x0303`
   *   - `0xAA 0x95 0x25` rowing telemetry begins
   *
   * Note on distance presets: the device does not receive a native
   * target-distance register — `EP_SCR_SWITCH` only selects the preset
   * *screen*. The iPad enforces stroke targets app-side
   * (`50m=10×5`, `5000m=1000×5`); SDK consumers are expected to do the
   * same comparing live distance from the AA95 stream.
   *
   * Must be preceded by {@link enterRowMode}; otherwise this throws.
   *
   * @param distance Optional preset — pass `'JustRow'` (or omit) for a
   *   free row; `'M50'` is independently verified, the rest are inferred.
   */
  async startRow(distance: RowingDistancePreset = 'JustRow'): Promise<void> {
    this.ensureConnected();

    if (!this._rowSubMenuOpen) {
      throw new CommandError(
        'startRow() requires enterRowMode() first. Call client.enterRowMode() ' +
          'before client.startRow().',
        'startRow'
      );
    }

    const action = ROW_START_ACTION_CODES[distance];
    if (action === undefined) {
      throw new InvalidSettingError(
        'rowingDistance',
        distance,
        Object.keys(ROW_START_ACTION_CODES)
      );
    }

    const scrSwitch = buildRowScrSwitchFrame(action);
    const refresh = buildVendorStateRefreshFrame();

    try {
      await this.writeFrame(scrSwitch);
      await this.writeFrame(refresh);
      this._rowStarted = true;
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(`Failed to start row: ${this.getErrorMessage(e)}`, 'startRow');
    }

    // Schedule reassert ticks. Each tick re-issues the same EP_SCR_SWITCH +
    // vendor refresh pair. Cancellation happens automatically on the next
    // arm() / cancel() / mode-change. The action code is captured by
    // closure so a subsequent startRow() with a different distance only
    // affects the new attempt.
    this.rowReassertScheduler.arm(async (attemptId) => {
      // Bail out if the attempt was superseded or the client is no longer
      // connected — the scheduler also checks attemptId, but this guards
      // against post-cleanup re-entry.
      if (!this.isConnected) return;
      if (attemptId !== this.rowReassertScheduler.currentAttemptId) return;
      try {
        await this.adapter!.write(scrSwitch);
        await this.adapter!.write(refresh);
      } catch (e) {
        // Reassert failures are non-fatal — we'll have at least one more
        // tick and the next user-initiated startRow() can recover. Surface
        // the error via the standard event channel so observability tools
        // can pick it up.
        const error =
          e instanceof Error ? e : new Error(`Reassert tick failed: ${this.getErrorMessage(e)}`);
        this._error = error;
        this.emit({ type: 'error', error });
      }
    });
  }

  /**
   * True if {@link startRow} has been called since the last connect /
   * mode-change. This reflects "command issued" — not necessarily
   * "device confirmed live" (the SDK doesn't yet decode confirmation
   * frames). Used by upstream MCP / mobile layers to gate session_start.
   */
  get isRowingActive(): boolean {
    return this._rowStarted;
  }
  // </Bug-22>

  /**
   * Get available training modes.
   */
  getAvailableModes(): TrainingMode[] {
    return getAvailableModes();
  }

  // ===========================================================================
  // Mode-Config Setters (added in 0.6.0)
  // ===========================================================================
  //
  // Settings persist GLOBALLY across mode switches. Resolves on adapter.write
  // completion; no modeConfirmation notification is emitted for opcode 0xa9 /
  // 0xc7 setters. `client.settings` does not currently reflect these values;
  // the device does not echo them in settings-update notifications as of
  // protocol v0.5.0.

  /**
   * Set damper level.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion; no modeConfirmation notification is emitted for opcode 0xa9 /
   * 0xc7 setters.
   *
   * Note: the underlying value is 0-9; the Voltra UI displays this as N+1
   * (i.e. level 0 -> "1" in the app).
   *
   * Reflected in `client.settings.damperLevel` once the device emits the next
   * `settingsUpdate` notification (paramId 0x0351).
   *
   * @param level Damper level (0-9)
   */
  async setDamperLevel(level: number): Promise<void> {
    this.ensureConnected();

    const cmd = getDamperLevelCommand(level);
    if (!cmd) {
      throw new InvalidSettingError('damperLevel', level, getAvailableDamperLevels());
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set damper level: ${this.getErrorMessage(e)}`,
        'setDamperLevel'
      );
    }
  }

  /**
   * Set assist mode (off / on).
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion; no modeConfirmation notification is emitted for opcode 0xa9 /
   * 0xc7 setters.
   *
   * Note: `client.settings` does not currently reflect this value; the device
   * does not echo it in settings-update notifications as of protocol v0.5.0.
   *
   * @param mode 'off' or 'on'
   */
  async setAssistMode(mode: 'off' | 'on'): Promise<void> {
    this.ensureConnected();

    const cmd = getAssistModeCommand(mode);
    if (!cmd) {
      throw new InvalidSettingError('assistMode', mode, ['off', 'on']);
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set assist mode: ${this.getErrorMessage(e)}`,
        'setAssistMode'
      );
    }
  }

  /**
   * Set resistance band max force.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion; no modeConfirmation notification is emitted for opcode 0xa9 /
   * 0xc7 setters.
   *
   * Note: `client.settings` does not currently reflect this value; the device
   * does not echo it in settings-update notifications as of protocol v0.5.0.
   *
   * @param lbs Max force in pounds (15-70)
   */
  async setBandMaxForce(lbs: number): Promise<void> {
    this.ensureConnected();

    const cmd = getBandMaxForceCommand(lbs);
    if (!cmd) {
      throw new InvalidSettingError('bandMaxForce', lbs, getAvailableBandMaxForce());
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set band max force: ${this.getErrorMessage(e)}`,
        'setBandMaxForce'
      );
    }
  }

  /**
   * Set isokinetic target speed.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion; no modeConfirmation notification is emitted for opcode 0xa9 /
   * 0xc7 setters.
   *
   * Unit conversion: input is mm/s. The Voltra UI shows the same value
   * divided by 1000 (m/s) — e.g. 1500 mm/s renders as "1.5 m/s".
   *
   * Note: `client.settings` does not currently reflect this value; the device
   * does not echo it in settings-update notifications as of protocol v0.5.0.
   *
   * @param mmPerSec Target speed in mm/s (0-2000, step 10)
   */
  async setIsokineticTargetSpeed(mmPerSec: number): Promise<void> {
    this.ensureConnected();

    const cmd = getIsokineticTargetSpeedCommand(mmPerSec);
    if (!cmd) {
      throw new InvalidSettingError(
        'isokineticTargetSpeed',
        mmPerSec,
        getAvailableIsokineticTargetSpeeds()
      );
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set isokinetic target speed: ${this.getErrorMessage(e)}`,
        'setIsokineticTargetSpeed'
      );
    }
  }

  /**
   * Set isokinetic eccentric mode.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion; no modeConfirmation notification is emitted for opcode 0xa9 /
   * 0xc7 setters.
   *
   * Note: `client.settings` does not currently reflect this value; the device
   * does not echo it in settings-update notifications as of protocol v0.5.0.
   *
   * @param mode 'isokinetic' or 'constant'
   */
  async setIsokineticEccMode(mode: 'isokinetic' | 'constant'): Promise<void> {
    this.ensureConnected();

    const cmd = getIsokineticEccModeCommand(mode);
    if (!cmd) {
      throw new InvalidSettingError('isokineticEccMode', mode, ['isokinetic', 'constant']);
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set isokinetic eccentric mode: ${this.getErrorMessage(e)}`,
        'setIsokineticEccMode'
      );
    }
  }

  /**
   * Set isokinetic eccentric speed limit.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion; no modeConfirmation notification is emitted for opcode 0xa9 /
   * 0xc7 setters.
   *
   * Note: `client.settings` does not currently reflect this value; the device
   * does not echo it in settings-update notifications as of protocol v0.5.0.
   *
   * @param mmPerSec Speed limit in mm/s; 0 = auto
   */
  async setIsokineticEccSpeedLimit(mmPerSec: number): Promise<void> {
    this.ensureConnected();

    const cmd = getIsokineticEccSpeedLimitCommand(mmPerSec);
    if (!cmd) {
      throw new InvalidSettingError(
        'isokineticEccSpeedLimit',
        mmPerSec,
        getAvailableIsokineticEccSpeedLimits()
      );
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set isokinetic eccentric speed limit: ${this.getErrorMessage(e)}`,
        'setIsokineticEccSpeedLimit'
      );
    }
  }

  /**
   * Set isokinetic eccentric constant-mode weight.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion; no modeConfirmation notification is emitted for opcode 0xa9 /
   * 0xc7 setters.
   *
   * Warning: when set on a connected device, this command causes an audible
   * beep on the unit — possibly a safety/range cue from the firmware. The
   * command itself succeeds and the value is applied.
   *
   * Note: `client.settings` does not currently reflect this value; the device
   * does not echo it in settings-update notifications as of protocol v0.5.0.
   *
   * @param lbs Weight in pounds (0-200)
   */
  async setIsokineticEccConstWeight(lbs: number): Promise<void> {
    this.ensureConnected();

    const cmd = getIsokineticEccConstWeightCommand(lbs);
    if (!cmd) {
      throw new InvalidSettingError(
        'isokineticEccConstWeight',
        lbs,
        getAvailableIsokineticEccConstWeights()
      );
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set isokinetic eccentric constant weight: ${this.getErrorMessage(e)}`,
        'setIsokineticEccConstWeight'
      );
    }
  }

  /**
   * Set isokinetic eccentric overload-mode weight.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion; no modeConfirmation notification is emitted for opcode 0xa9 /
   * 0xc7 setters.
   *
   * Warning: when set on a connected device, this command causes an audible
   * beep on the unit — possibly a safety/range cue from the firmware. The
   * command itself succeeds and the value is applied.
   *
   * Note: `client.settings` does not currently reflect this value; the device
   * does not echo it in settings-update notifications as of protocol v0.5.0.
   *
   * @param lbs Weight in pounds (0-200)
   */
  async setIsokineticEccOverloadWeight(lbs: number): Promise<void> {
    this.ensureConnected();

    const cmd = getIsokineticEccOverloadWeightCommand(lbs);
    if (!cmd) {
      throw new InvalidSettingError(
        'isokineticEccOverloadWeight',
        lbs,
        getAvailableIsokineticEccOverloadWeights()
      );
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set isokinetic eccentric overload weight: ${this.getErrorMessage(e)}`,
        'setIsokineticEccOverloadWeight'
      );
    }
  }

  /** Get available damper levels (0-9). */
  getAvailableDamperLevels(): number[] {
    return getAvailableDamperLevels();
  }

  /** Get available resistance band max-force values (lbs). */
  getAvailableBandMaxForce(): number[] {
    return getAvailableBandMaxForce();
  }

  /** Get available isokinetic target speeds (mm/s). */
  getAvailableIsokineticTargetSpeeds(): number[] {
    return getAvailableIsokineticTargetSpeeds();
  }

  /** Get available isokinetic eccentric speed limits (mm/s; 0 = auto). */
  getAvailableIsokineticEccSpeedLimits(): number[] {
    return getAvailableIsokineticEccSpeedLimits();
  }

  /** Get available isokinetic eccentric constant-mode weights (lbs). */
  getAvailableIsokineticEccConstWeights(): number[] {
    return getAvailableIsokineticEccConstWeights();
  }

  /** Get available isokinetic eccentric overload-mode weights (lbs). */
  getAvailableIsokineticEccOverloadWeights(): number[] {
    return getAvailableIsokineticEccOverloadWeights();
  }

  // ===========================================================================
  // QoL Setters (added in 0.6.0, @experimental)
  // ===========================================================================
  //
  // The four setters below were typed in voltra-private's regen but were not
  // validated end-to-end on-device during phase-5 Block F (only the underlying
  // register defs were validated in voltra-private PR #11). The protocol bytes
  // are correct; device-side behavior may produce side effects not yet
  // documented. File an issue if observed behavior differs from expectation.

  /**
   * Set telemetry frame emission rate.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion only.
   *
   * @experimental — register validated in voltra-private PR #11 but not yet
   * validated end-to-end on-device. The protocol bytes are correct; the
   * device-side behavior may produce side effects not yet documented. File
   * an issue if observed behavior differs from expectation.
   *
   * @param hz Telemetry frame emission rate in Hz
   */
  async setTelemetryRate(hz: number): Promise<void> {
    this.ensureConnected();

    const cmd = getTelemetryRateCommand(hz);
    if (!cmd) {
      throw new InvalidSettingError('telemetryRate', hz, getAvailableTelemetryRates());
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set telemetry rate: ${this.getErrorMessage(e)}`,
        'setTelemetryRate'
      );
    }
  }

  /**
   * Set telemetry subscription state.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion only.
   *
   * @experimental — register validated in voltra-private PR #11 but not yet
   * validated end-to-end on-device. The protocol bytes are correct; the
   * device-side behavior may produce side effects not yet documented. File
   * an issue if observed behavior differs from expectation.
   *
   * @param mode 'none' or 'all'
   */
  async setTelemetrySubscribe(mode: 'none' | 'all'): Promise<void> {
    this.ensureConnected();

    const cmd = getTelemetrySubscribeCommand(mode);
    if (!cmd) {
      throw new InvalidSettingError('telemetrySubscribe', mode, ['none', 'all']);
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set telemetry subscribe: ${this.getErrorMessage(e)}`,
        'setTelemetrySubscribe'
      );
    }
  }

  /**
   * Set cable trigger state.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion only.
   *
   * @experimental — register validated in voltra-private PR #11 but not yet
   * validated end-to-end on-device. The protocol bytes are correct; the
   * device-side behavior may produce side effects not yet documented. File
   * an issue if observed behavior differs from expectation.
   *
   * @param mode 'open' or 'close'
   */
  async setCableTrigger(mode: 'open' | 'close'): Promise<void> {
    this.ensureConnected();

    const cmd = getCableTriggerCommand(mode);
    if (!cmd) {
      throw new InvalidSettingError('cableTrigger', mode, ['open', 'close']);
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set cable trigger: ${this.getErrorMessage(e)}`,
        'setCableTrigger'
      );
    }
  }

  /**
   * Set resistance experience preset.
   *
   * Settings persist GLOBALLY across mode switches. Resolves on adapter.write
   * completion only.
   *
   * @experimental — register validated in voltra-private PR #11 but not yet
   * validated end-to-end on-device. The protocol bytes are correct; the
   * device-side behavior may produce side effects not yet documented. File
   * an issue if observed behavior differs from expectation.
   *
   * @param mode 'intense' or 'standard'
   */
  async setResistanceExperience(mode: 'intense' | 'standard'): Promise<void> {
    this.ensureConnected();

    const cmd = getResistanceExperienceCommand(mode);
    if (!cmd) {
      throw new InvalidSettingError('resistanceExperience', mode, ['intense', 'standard']);
    }

    try {
      await this.writeFrame(cmd);
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to set resistance experience: ${this.getErrorMessage(e)}`,
        'setResistanceExperience'
      );
    }
  }

  /** Get available telemetry rates (Hz). @experimental */
  getAvailableTelemetryRates(): number[] {
    return getAvailableTelemetryRates();
  }

  // ===========================================================================
  // Guided-load (direct-load, Phase 1g, 0.6.3+, @experimental)
  // ===========================================================================
  //
  // The firmware "direct-load" flow ramps from a fixed start floor to the
  // user's target weight after a single trigger byte. After we send the
  // trigger, the device does NOT push any state-change frames — the SDK
  // must poll the 4 status registers (`0x538D` / `0x53C7` / `0x53C8` /
  // `0x53C9`) every 500ms to observe the READY → ACTIVE transition. This
  // method drives that polling for you and surfaces a `GuidedLoadState`
  // object via `onGuidedLoadState`. See voltra-private/research/direct-
  // load-protocol-2026-05-06-android-deep.md for the protocol rationale.

  /**
   * Get current guided-load state snapshot.
   *
   * @experimental — see {@link startGuidedLoad}.
   */
  get guidedLoadState(): GuidedLoadState {
    return { ...this._guidedLoadState };
  }

  /**
   * Trigger the firmware direct-load flow at the supplied target weight.
   *
   * Performs (mirroring AndroidVoltraClient.directLoad):
   *   1. setWeight(targetWeightLbs) — writes BP_BASE_WEIGHT (target)
   *   2. write the `0xAA 0x12` direct-load trigger frame
   *   3. start polling the 4 status registers every `pollIntervalMs`
   *      (default 500ms) for `pollDurationMs` (default 18000ms)
   *
   * The promise resolves once the trigger has been written and the polling
   * loop is armed; transitions are surfaced via `onGuidedLoadState`. Polling
   * stops automatically after the duration elapses (`phase: 'timeout'` if
   * the device never reached ACTIVE).
   *
   * @experimental — register IDs and state-machine semantics derive from an
   * Android-repo deep-scrub (voltra-private/research/direct-load-protocol-
   * 2026-05-06-android-deep.md). The 18s polling window and 500ms cadence
   * mirror the Android client exactly. The `0x53C7` enum and `0x53C8`
   * milliseconds-vs-seconds interpretation are not yet validated end-to-end.
   *
   * @param opts Guided-load options
   */
  async startGuidedLoad(opts: GuidedLoadOptions): Promise<void> {
    this.ensureConnected();
    if (this._guidedLoadActive) {
      throw new CommandError(
        'Guided-load already in progress; call exitGuidedLoad() before starting a new flow.',
        'startGuidedLoad'
      );
    }

    const pollIntervalMs = opts.pollIntervalMs ?? 500;
    const pollDurationMs = opts.pollDurationMs ?? 18000;

    // Step 1: write the target weight (BP_BASE_WEIGHT). `setWeight` already
    // validates against the available-weights table; out-of-range values
    // surface as `InvalidSettingError` before any trigger is written.
    await this.setWeight(opts.targetWeightLbs);

    // Step 2: write the direct-load trigger frame.
    try {
      await this.writeFrame(buildGuidedLoadTriggerFrame());
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to write guided-load trigger: ${this.getErrorMessage(e)}`,
        'startGuidedLoad'
      );
    }

    // Transition out of 'idle' immediately so observers see the armed
    // state even if the first poll response is delayed.
    this._guidedLoadActive = true;
    this.updateGuidedLoadState({ phase: 'armed' });

    // Step 3: arm the polling loop. The first read fires after one
    // interval — callers may also `await client.exitGuidedLoad()` to
    // bail out before the window closes.
    this.guidedLoadPollTimer = setInterval(() => {
      this.pollGuidedLoadStatus().catch((e) => {
        console.warn('[VoltraClient] guided-load poll error:', e);
      });
    }, pollIntervalMs);

    this.guidedLoadEndTimer = setTimeout(() => {
      this.stopGuidedLoadPolling();
      // If we never reached ACTIVE, surface 'timeout' so callers can
      // distinguish a clean exit from a window-close-without-engage.
      if (this._guidedLoadState.phase !== 'active' && this._guidedLoadState.phase !== 'exited') {
        this.updateGuidedLoadState({ phase: 'timeout' });
      }
      this._guidedLoadActive = false;
    }, pollDurationMs);
  }

  /**
   * Exit the guided-load flow cleanly by writing
   * `BP_SET_FITNESS_MODE = 0x0004` (STRENGTH_READY). Stops the poll loop
   * and transitions state to `'exited'`.
   *
   * @experimental — see {@link startGuidedLoad}.
   */
  async exitGuidedLoad(): Promise<void> {
    this.ensureConnected();
    this.stopGuidedLoadPolling();

    try {
      await this.writeFrame(buildGuidedLoadExitFrame());
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(
        `Failed to exit guided-load: ${this.getErrorMessage(e)}`,
        'exitGuidedLoad'
      );
    }

    this._guidedLoadActive = false;
    this.updateGuidedLoadState({ phase: 'exited' });
  }

  /**
   * Subscribe to guided-load state changes. The listener fires on every
   * decoded poll response (with the latest known field values) AND on
   * synthesized phase transitions (`'armed'`, `'timeout'`, `'exited'`).
   *
   * @experimental — see {@link startGuidedLoad}.
   * @param listener Guided-load state listener
   * @returns Unsubscribe function
   */
  onGuidedLoadState(listener: GuidedLoadStateListener): () => void {
    this.guidedLoadStateListeners.add(listener);
    return () => this.guidedLoadStateListeners.delete(listener);
  }

  // ===========================================================================
  // Recording
  // ===========================================================================

  /**
   * Prepare for recording (sends PREPARE + SETUP commands).
   * Call this before starting a set to minimize latency.
   */
  async prepareRecording(): Promise<void> {
    this.ensureConnected();

    try {
      this.setRecordingState('preparing');

      await this.writeFrame(Workout.PREPARE);
      await delay(200);
      await this.writeFrame(Workout.SETUP);
      await delay(300);

      this.setRecordingState('ready');
    } catch (e) {
      this.setRecordingState('idle');
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(`Failed to prepare: ${this.getErrorMessage(e)}`, 'prepareRecording');
    }
  }

  /**
   * Start recording (engage motor).
   * If not prepared, will prepare first.
   */
  async startRecording(): Promise<void> {
    this.ensureConnected();

    // Prepare if not ready
    if (this._recordingState !== 'ready') {
      await this.prepareRecording();
    }

    try {
      await this.writeFrame(Workout.GO);
      this.setRecordingState('active');
    } catch (e) {
      if (e instanceof ConnectionError) throw e;
      throw new CommandError(`Failed to start: ${this.getErrorMessage(e)}`, 'startRecording');
    }
  }

  /**
   * Stop recording (disengage motor and exit workout mode).
   */
  async stopRecording(): Promise<void> {
    if (this._recordingState === 'idle') {
      return;
    }

    this.setRecordingState('stopping');

    try {
      if (this.adapter) {
        await this.writeFrame(Workout.STOP);
      }
    } catch (e) {
      console.warn('[VoltraClient] Stop error:', e);
    }

    this.setRecordingState('idle');
  }

  /**
   * End the current set but stay in workout mode.
   * Use this between sets when there are more sets to do.
   */
  async endSet(): Promise<void> {
    if (this._recordingState !== 'active') {
      return;
    }

    try {
      await this.writeFrame(Workout.STOP);
      this.setRecordingState('ready');
    } catch (e) {
      console.warn('[VoltraClient] End set error:', e);
    }
  }

  // ===========================================================================
  // Event Subscriptions
  // ===========================================================================

  /**
   * Subscribe to client events.
   *
   * @param listener Event listener
   * @returns Unsubscribe function
   */
  subscribe(listener: VoltraClientEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to telemetry frames.
   * Shorthand for subscribing to 'frame' events.
   *
   * @param listener Frame listener
   * @returns Unsubscribe function
   */
  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /**
   * Subscribe to raw BLE notifications BEFORE decode. Fires for every
   * inbound notification — typed frames, vendor frames, async-updates,
   * and frames the decoder cannot classify (returns `'unknown'`).
   *
   * Diagnostic / capture surface: byte-level work (cmd=0x10 reconnaissance,
   * bootstrap parity, capture-replay regression). Consumers needing typed
   * events should use the typed listeners (`onFrame`, `onPerRep`, etc.).
   *
   * Added 0.6.2.
   *
   * @param listener Raw frame listener
   * @returns Unsubscribe function
   */
  onRawFrame(listener: RawFrameListener): () => void {
    this.rawFrameListeners.add(listener);
    return () => this.rawFrameListeners.delete(listener);
  }

  /**
   * Subscribe to connection state changes.
   *
   * @param listener State listener
   * @returns Unsubscribe function
   */
  onConnectionStateChange(listener: (state: VoltraConnectionState) => void): () => void {
    const wrappedListener: VoltraClientEventListener = (event) => {
      if (event.type === 'connectionStateChanged') {
        listener(event.state);
      }
    };
    this.listeners.add(wrappedListener);
    return () => this.listeners.delete(wrappedListener);
  }

  /**
   * Subscribe to typed `perRep` frame events. Fires twice per rep —
   * pull start (motionPhase 1) and return start (motionPhase 2).
   *
   * Replaces the 0.5.0 `onRepBoundary` listener (removed in 0.6.0).
   *
   * @param listener perRep listener
   * @returns Unsubscribe function
   */
  onPerRep(listener: PerRepListener): () => void {
    this.perRepListeners.add(listener);
    return () => this.perRepListeners.delete(listener);
  }

  /**
   * Subscribe to typed end-of-set `summary` frame events. Fires once at
   * end-of-set.
   *
   * Each `schemaVersion` (1=weight, 2=band, 3=damper, 4=isokinetic) carries
   * a different mode-specific aggregate field map at frame offset 18+ — only
   * the universal `setCounter` / `repCount` fields are decoded. Consume
   * `event.raw` for fields beyond those two.
   *
   * @param listener summary listener
   * @returns Unsubscribe function
   */
  onSummary(listener: SummaryListener): () => void {
    this.summaryListeners.add(listener);
    return () => this.summaryListeners.delete(listener);
  }

  /**
   * Subscribe to typed `aa 85 5f` set-summary frame events. The device emits
   * one of these per set in WT/RB/Damper modes after all reps complete, with
   * the final `repCount` and `repDurationMs` baked in. This is the canonical
   * per-set close marker — `onSummary` (`aa 86 7d`) is workout-end / post-STOP
   * only and may not fire at all in some modes.
   *
   * Renamed from `onPreSummary` in 0.9.0 — the legacy name + "fires before
   * final rep" docstring were misnomers. See
   * `voltra-private/research/aa-subtype-catalog-2026-05-07-android-deep.md`
   * §7.5 for the cross-decompile analysis.
   *
   * @param listener setSummary listener
   * @returns Unsubscribe function
   */
  onSetSummary(listener: SetSummaryListener): () => void {
    this.setSummaryListeners.add(listener);
    return () => this.setSummaryListeners.delete(listener);
  }

  /**
   * Subscribe to typed `inProgress` heartbeat events. Fires ~1 Hz during
   * active sets — use sparingly in latency-sensitive code paths.
   *
   * Replaces the 0.5.0 `onSetBoundary` listener (removed in 0.6.0).
   *
   * @param listener inProgress listener
   * @returns Unsubscribe function
   */
  onInProgress(listener: InProgressListener): () => void {
    this.inProgressListeners.add(listener);
    return () => this.inProgressListeners.delete(listener);
  }

  /**
   * Subscribe to mode confirmation events.
   * Called when the device confirms a training mode change.
   *
   * @param listener Mode confirmed listener
   * @returns Unsubscribe function
   */
  onModeConfirmed(listener: ModeConfirmedListener): () => void {
    this.modeConfirmedListeners.add(listener);
    return () => this.modeConfirmedListeners.delete(listener);
  }

  /**
   * Subscribe to settings update events.
   * Called when the device reports its current settings.
   *
   * **0.6.2 bootstrap replay**: if a settings cascade has already been
   * received before this listener attaches (the common case for consumers
   * who attach listeners after `manager.connect()` resolves — bootstrap
   * fires inside `connect()`), the most recent cascade is replayed
   * synchronously. Each listener attach gets at most one replay event.
   *
   * @param listener Settings update listener
   * @returns Unsubscribe function
   */
  onSettingsUpdate(listener: SettingsUpdateListener): () => void {
    this.settingsUpdateListeners.add(listener);
    if (this._lastDeviceSettings !== null) {
      listener(this._lastDeviceSettings);
    }
    return () => this.settingsUpdateListeners.delete(listener);
  }

  /**
   * Subscribe to `cmd=0x07` state-dump events (52-byte `aa 80 25` envelope).
   *
   * The payload exposes fields that the legacy `settings_update` decode does
   * NOT surface — chains-active flag, fitness-assist toggle, chain target
   * weight in tenths of pounds. Use this listener to react to assist-mode
   * transitions (Bug 26) and chain-engagement state changes.
   *
   * The raw `assistMode` byte is preserved (`1` = on, `8` = idle, anything
   * else should be treated as off — see asymmetric-off semantics for
   * `FITNESS_ASSIST_MODE` documented in voltra-private research notes A10/A11).
   *
   * @param listener State-dump listener
   * @returns Unsubscribe function
   */
  onStateDump(listener: StateDumpListener): () => void {
    this.stateDumpListeners.add(listener);
    return () => this.stateDumpListeners.delete(listener);
  }

  /**
   * Subscribe to battery update events.
   * Called when the device reports its battery level.
   *
   * @param listener Battery update listener
   * @returns Unsubscribe function
   */
  onBatteryUpdate(listener: BatteryUpdateListener): () => void {
    this.batteryUpdateListeners.add(listener);
    return () => this.batteryUpdateListeners.delete(listener);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Dispose of the client and release all resources.
   * After calling dispose(), the client cannot be used.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    // Disconnect if connected
    if (this.isConnected) {
      this.disconnect().catch(() => {});
    }

    // Clear all listeners
    this.listeners.clear();
    this.frameListeners.clear();
    this.rawFrameListeners.clear();
    this.perRepListeners.clear();
    this.summaryListeners.clear();
    this.setSummaryListeners.clear();
    this.inProgressListeners.clear();
    this.modeConfirmedListeners.clear();
    this.settingsUpdateListeners.clear();
    this.stateDumpListeners.clear();
    this.batteryUpdateListeners.clear();
    this.guidedLoadStateListeners.clear();

    // Stop any in-flight guided-load polling
    this.stopGuidedLoadPolling();
    this._guidedLoadActive = false;

    // Cleanup
    this.cleanup();

    // Release peripheral-bridge subscriptions when applicable. The
    // bridge's `dispose()` is idempotent.
    this.peripheralBridge?.dispose();
    this.peripheralBridge = null;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async authenticate(): Promise<void> {
    try {
      await this.adapter!.write(Auth.DEVICE_ID);
      await delay(Timing.AUTH_TIMEOUT_MS);
    } catch (e) {
      throw new AuthenticationError(`Authentication failed: ${this.getErrorMessage(e)}`);
    }
  }

  private async initialize(): Promise<void> {
    try {
      for (const cmd of Init.SEQUENCE) {
        await this.adapter!.write(cmd);
        await delay(Timing.INIT_COMMAND_DELAY_MS);
      }
    } catch (e) {
      throw new ConnectionError(`Initialization failed: ${this.getErrorMessage(e)}`);
    }
  }

  private setupNotificationHandler(): void {
    if (!this.adapter) return;

    const handler = createNotificationHandler({
      onRawFrame: (data) => {
        this.rawFrameListeners.forEach((listener) => listener(data));
      },
      onFrame: (frame) => {
        this.emit({ type: 'frame', frame });
        this.frameListeners.forEach((listener) => listener(frame));
      },
      onPerRep: (event) => {
        this.emit({ type: 'perRep', event });
        this.perRepListeners.forEach((listener) => listener(event));
      },
      onSummary: (event) => {
        this.emit({ type: 'summary', event });
        this.summaryListeners.forEach((listener) => listener(event));
      },
      onSetSummary: (event) => {
        this.emit({ type: 'setSummary', event });
        this.setSummaryListeners.forEach((listener) => listener(event));
      },
      onInProgress: (event) => {
        this.emit({ type: 'inProgress', event });
        this.inProgressListeners.forEach((listener) => listener(event));
      },
      onModeConfirmed: (mode) => {
        this.emit({ type: 'modeConfirmed', mode });
        this.modeConfirmedListeners.forEach((listener) => listener(mode));
      },
      onSettingsUpdate: (settings) => {
        // Cache for bootstrap replay (see onSettingsUpdate registration).
        this._lastDeviceSettings = settings;
        this.emit({ type: 'settingsUpdate', settings });
        this.settingsUpdateListeners.forEach((listener) => listener(settings));
        this.syncSettingsFromDevice(settings);
      },
      onStateDump: (event) => {
        this.emit({ type: 'stateDump', event });
        this.stateDumpListeners.forEach((listener) => listener(event));
      },
      onBatteryUpdate: (battery) => {
        this.emit({ type: 'batteryUpdate', battery });
        this.batteryUpdateListeners.forEach((listener) => listener(battery));
      },
    });

    const baseUnsub = this.adapter.onNotification(handler);

    // Side-channel: the multi-param / settings_update notifications can
    // carry guided-load status registers too. We hook a second listener so
    // the main decoder remains untouched and guided-load decoding can be
    // skipped entirely when the flow is inactive.
    const guidedLoadUnsub = this.adapter.onNotification((data) => {
      if (!this._guidedLoadActive) return;
      const fields = decodeGuidedLoadStatus(data);
      if (fields !== null) {
        this.applyGuidedLoadStatusFields(fields);
      }
    });

    this.notificationUnsubscribe = () => {
      baseUnsub();
      guidedLoadUnsub();
    };
  }

  // ===========================================================================
  // Guided-load private helpers
  // ===========================================================================

  /**
   * Write the 4-paramID read frame so the device responds via a multi-param
   * notification. The notification decoder fills in `_guidedLoadState`.
   */
  private async pollGuidedLoadStatus(): Promise<void> {
    if (!this.adapter || !this._guidedLoadActive) return;
    try {
      await this.adapter.write(buildGuidedLoadStatusReadFrame());
    } catch (e) {
      // Swallow — the polling loop fires every 500ms; one failed write
      // shouldn't terminate the flow. Log via console.warn (mirrors
      // existing setter error policy).
      console.warn('[VoltraClient] guided-load poll write failed:', e);
    }
  }

  /**
   * Apply a partial-fields update (any of the 4 status registers + the
   * fitness-mode raw value) to the cached guided-load state. Phase is
   * derived from `fitnessModeRaw` + `countdownMs` per the state machine
   * documented in `types.ts`.
   */
  private applyGuidedLoadStatusFields(fields: GuidedLoadStatusFields): void {
    const next: GuidedLoadState = { ...this._guidedLoadState };

    if (fields.fitnessModeRaw !== undefined) {
      next.fitnessModeRaw = fields.fitnessModeRaw;
    }
    if (fields.countdownMs !== undefined) {
      next.countdownRemainingMs = fields.countdownMs;
    }

    // Phase resolution rules (mirrors §3-§5 of the design proposal):
    //  * raw mode 0x0027 → 'active' (engaged at target). Stop polling.
    //  * raw mode 0x0026 + countdownMs > 0 → 'countdown' (armed, ticking).
    //  * raw mode 0x0026 + no countdown info → 'armed'.
    //  * primaryStatus signals the arm bit; without a fitness-mode
    //    register echo we fall back to it for state inference.
    const mode = next.fitnessModeRaw;
    const cd = next.countdownRemainingMs;

    if (mode === GUIDED_LOAD_MODE_ACTIVE) {
      next.phase = 'active';
    } else if (mode === GUIDED_LOAD_MODE_ARMED) {
      if (cd !== null && cd > 0) {
        next.phase = 'countdown';
      } else if (cd === 0) {
        // Countdown elapsed but mode hasn't flipped yet — mid-engage
        next.phase = 'engaging';
      } else {
        next.phase = 'armed';
      }
    } else if (cd !== null && cd > 0) {
      // No mode echo yet but countdown is ticking → user must be pulling.
      next.phase = 'countdown';
    } else if (
      fields.primaryStatus !== undefined &&
      fields.primaryStatus !== 0 &&
      this._guidedLoadState.phase === 'idle'
    ) {
      // Bootstrap case: status arrived before our local 'armed' synthesis.
      next.phase = 'armed';
    }

    this.updateGuidedLoadState(next, /* preserveDerived */ true);

    // Auto-stop polling once we observe ACTIVE — there are no further
    // transitions to chase, and the device will continue rep telemetry
    // until the user disengages.
    if (next.phase === 'active') {
      this.stopGuidedLoadPolling();
      this._guidedLoadActive = false;
    }
  }

  /** Update the cached state and notify listeners. */
  private updateGuidedLoadState(partial: Partial<GuidedLoadState>, preserveDerived = false): void {
    const next: GuidedLoadState = preserveDerived
      ? (partial as GuidedLoadState)
      : {
          ...this._guidedLoadState,
          ...partial,
        };

    // Reference-equality skip: if nothing changed, don't notify.
    const prev = this._guidedLoadState;
    if (
      next.phase === prev.phase &&
      next.countdownRemainingMs === prev.countdownRemainingMs &&
      next.fitnessModeRaw === prev.fitnessModeRaw
    ) {
      return;
    }

    this._guidedLoadState = next;
    this.emit({ type: 'guidedLoadState', state: { ...next } });
    this.guidedLoadStateListeners.forEach((listener) => {
      try {
        listener({ ...next });
      } catch (e) {
        console.error('[VoltraClient] guided-load listener error:', e);
      }
    });
  }

  /** Cancel the guided-load poll + end timers. Idempotent. */
  private stopGuidedLoadPolling(): void {
    if (this.guidedLoadPollTimer !== null) {
      clearInterval(this.guidedLoadPollTimer);
      this.guidedLoadPollTimer = null;
    }
    if (this.guidedLoadEndTimer !== null) {
      clearTimeout(this.guidedLoadEndTimer);
      this.guidedLoadEndTimer = null;
    }
  }

  private setupDisconnectHandler(): void {
    if (!this.adapter) return;

    const disconnectUnsub = setupDisconnectMonitor(
      this.adapter,
      this.options,
      () => this._connectionState === 'connected',
      () => this.handleUnexpectedDisconnect()
    );

    // Chain with existing notification unsubscribe for cleanup
    if (disconnectUnsub) {
      const originalUnsubscribe = this.notificationUnsubscribe;
      this.notificationUnsubscribe = () => {
        originalUnsubscribe?.();
        disconnectUnsub();
      };
    }
  }

  private async handleUnexpectedDisconnect(): Promise<void> {
    if (!this.options.autoReconnect || !this._lastConnectedDevice) {
      this.cleanup();
      this.setConnectionState('disconnected');
      this.emit({ type: 'disconnected', deviceId: this._connectedDeviceId ?? 'unknown' });
      return;
    }

    this._isReconnecting = true;
    this._reconnectAttempt = 0;

    const lastDevice = this._lastConnectedDevice;
    const result = await attemptReconnect(this.options, {
      onReconnecting: (attempt, maxAttempts) => {
        this._reconnectAttempt = attempt;
        this.emit({ type: 'reconnecting', attempt, maxAttempts });
      },
      reconnect: () => this.connect(lastDevice),
      onReconnectFailed: () => {
        this.cleanup();
        this.setConnectionState('disconnected');
        this.emit({ type: 'disconnected', deviceId: this._connectedDeviceId ?? 'unknown' });
      },
    });

    this._isReconnecting = result.isReconnecting;
  }

  private cleanup(): void {
    this.notificationUnsubscribe?.();
    this.notificationUnsubscribe = null;
    this._connectedDeviceId = null;
    this._connectedDeviceName = null;
    // Bug 17 fix: do NOT blanket-reset `_settings` to defaults on cleanup.
    // The previous reset (`this._settings = { ...DEFAULT_SETTINGS };`) was
    // the proximate cause of post-reconnect SDK reading defaults — the
    // 3-packet init produced no settings cascade, leaving `_settings`
    // stuck at `DEFAULT_SETTINGS` until a write triggered an async cmd=0x10
    // update. The bootstrap step-10 query now refreshes `_settings` on
    // every connect; keeping last-known settings here gives `getState()`
    // callers stable values across the brief reconnect window.
    this._recordingState = 'idle';
    // <Bug-22>
    this.rowReassertScheduler.cancel();
    this._rowSubMenuOpen = false;
    this._rowStarted = false;
    // </Bug-22>
    // Drop any in-flight guided-load polling on disconnect — the device
    // is gone and the registers can no longer be read.
    this.stopGuidedLoadPolling();
    this._guidedLoadActive = false;
    // Drop the bootstrap-replay cache: a stale cascade from a different
    // connection should not leak into a subsequent listener attach.
    this._lastDeviceSettings = null;
  }

  private setConnectionState(state: VoltraConnectionState): void {
    if (!isValidVoltraTransition(this._connectionState, state)) {
      console.warn(`[VoltraClient] Invalid state transition: ${this._connectionState} -> ${state}`);
    }
    this._connectionState = state;
    this.emit({ type: 'connectionStateChanged', state });
  }

  private setRecordingState(state: VoltraRecordingState): void {
    this._recordingState = state;
    this.emit({ type: 'recordingStateChanged', state });
  }

  private emit(event: VoltraClientEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (e) {
        console.error('[VoltraClient] Event listener error:', e);
      }
    });
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Client has been disposed');
    }
  }

  private ensureAdapter(): void {
    if (!this.adapter) {
      throw new Error(
        'No adapter configured. Call setAdapter() or provide adapter in constructor.'
      );
    }
  }

  private ensureConnected(): void {
    this.ensureNotDisposed();
    if (!this.isConnected) {
      throw new NotConnectedError();
    }
    // Bug 30: the client's tracked `_connectionState` and the adapter's
    // write-channel handle are independent. After `gattserverdisconnected`
    // (or equivalent on native), the adapter nulls its write characteristic
    // but the client is unaware unless `autoReconnect=true`. Cross-check the
    // adapter so a setter call against a half-dead link reports the correct
    // disconnect rather than hanging on an opaque write rejection.
    if (this.adapter && !this.adapter.isLinkAlive()) {
      this.flipToDisconnected();
      throw new ConnectionError(
        'BLE link lost — adapter write channel is no longer alive',
        ErrorCode.CONNECTION_LOST
      );
    }
  }

  /**
   * Write a frame and treat any rejection as proof the BLE link is
   * functionally dead. Bug 30 follow-up: the 0.7.2 `isLinkAlive()` check in
   * `ensureConnected()` catches adapter-level state splits BEFORE a write,
   * but a writeChar handle can also exist while the underlying GATT write
   * pipe is jammed (supervision-timeout-adjacent or MTU-window collapse).
   * In that state `isLinkAlive()` still reports alive, the adapter throws
   * `Write failed`, and the SDK previously surfaced an opaque
   * `CommandError`. Per `feedback_ble_write_fail_reconnect_not_retry`, a
   * write failure means the consumer must reconnect — retrying the same
   * setter is futile. Flip state to `'disconnected'`, fire the disconnect
   * listener path, and rethrow as `CONNECTION_LOST` so the next setter
   * call hits `ensureConnected()` and bails out immediately.
   */
  private async writeFrame(data: Uint8Array): Promise<void> {
    try {
      await this.adapter!.write(data);
    } catch (e) {
      this.flipToDisconnected();
      const cause = e instanceof Error ? e : undefined;
      throw new ConnectionError(
        `BLE write failed — link is functionally dead, reconnect required: ${this.getErrorMessage(e)}`,
        ErrorCode.CONNECTION_LOST,
        cause
      );
    }
  }

  /**
   * Tear down per-connection state, mark the client disconnected, and emit
   * the `'disconnected'` event. Shared by `ensureConnected()` (link-dead
   * pre-check) and `writeFrame()` (write-failed post-check) so both paths
   * reach the same observable end-state.
   */
  private flipToDisconnected(): void {
    const deviceId = this._connectedDeviceId ?? 'unknown';
    this.cleanup();
    this.setConnectionState('disconnected');
    this.emit({ type: 'disconnected', deviceId });
  }

  private wrapError(e: unknown, context: string): Error {
    if (e instanceof Error) {
      if (e.message.includes('timeout')) {
        return new TimeoutError(`${context}: ${e.message}`, Timing.AUTH_TIMEOUT_MS, e);
      }
      if (e.message.includes('auth')) {
        return new AuthenticationError(`${context}: ${e.message}`, ErrorCode.AUTH_FAILED, e);
      }
      return new ConnectionError(`${context}: ${e.message}`, ErrorCode.CONNECTION_FAILED, e);
    }
    return new ConnectionError(`${context}: ${String(e)}`);
  }

  private getErrorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  /**
   * Sync internal settings state from device-reported settings.
   * Called when the device sends a settings_update notification.
   */
  private syncSettingsFromDevice(deviceSettings: DeviceSettings): void {
    if (deviceSettings.baseWeight !== undefined) {
      this._settings.weight = deviceSettings.baseWeight;
    }
    if (deviceSettings.chains !== undefined) {
      this._settings.chains = deviceSettings.chains;
    }
    if (deviceSettings.inverseChains !== undefined) {
      this._settings.inverseChains = deviceSettings.inverseChains;
    }
    if (deviceSettings.eccentric !== undefined) {
      this._settings.eccentric = deviceSettings.eccentric;
    }
    if (deviceSettings.trainingMode !== undefined) {
      this._settings.mode = deviceSettings.trainingMode;
    }
    if (deviceSettings.damperLevel !== undefined) {
      this._settings.damperLevel = deviceSettings.damperLevel;
    }
  }
}
