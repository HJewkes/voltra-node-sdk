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
} from '../voltra/protocol/commands';
import { TrainingMode } from '../voltra/protocol/constants';
import { delay } from '../shared/utils';
import { createNotificationHandler } from './notification-dispatcher';
import { setupDisconnectMonitor, attemptReconnect } from './reconnect-handler';
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
  RepBoundaryListener,
  SetBoundaryListener,
  ModeConfirmedListener,
  SettingsUpdateListener,
  BatteryUpdateListener,
  ScanOptions,
} from './types';
import type { DeviceSettings } from '../voltra/protocol/types';

/**
 * Default client options.
 */
const DEFAULT_OPTIONS: Required<Omit<VoltraClientOptions, 'adapter'>> = {
  autoReconnect: false,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
};

/**
 * High-level client for connecting to and controlling a Voltra device.
 */
export class VoltraClient {
  // Options
  private readonly options: Required<Omit<VoltraClientOptions, 'adapter'>>;

  // Adapter
  private adapter: BLEAdapter | null;

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
  private repBoundaryListeners: Set<RepBoundaryListener> = new Set();
  private setBoundaryListeners: Set<SetBoundaryListener> = new Set();
  private modeConfirmedListeners: Set<ModeConfirmedListener> = new Set();
  private settingsUpdateListeners: Set<SettingsUpdateListener> = new Set();
  private batteryUpdateListeners: Set<BatteryUpdateListener> = new Set();

  // Disposed flag
  private disposed = false;

  constructor(options: VoltraClientOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.adapter = options.adapter ?? null;
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
   */
  getAdapter(): BLEAdapter | null {
    return this.adapter;
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
      // Connect
      this.setConnectionState('connecting');
      await this.adapter!.connect(device.id);

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
      this._settings = { ...DEFAULT_SETTINGS };
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
      await this.adapter!.write(cmd);
      this._settings.weight = lbs;
    } catch (e) {
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
      await this.adapter!.write(cmd);
      this._settings.chains = lbs;
    } catch (e) {
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
      await this.adapter!.write(cmd);
      this._settings.inverseChains = lbs;
    } catch (e) {
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
      await this.adapter!.write(cmd);
      this._settings.eccentric = percent;
    } catch (e) {
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
   * @param mode Training mode to set
   */
  async setMode(mode: TrainingMode): Promise<void> {
    this.ensureConnected();

    const cmd = getModeCommand(mode);
    if (!cmd) {
      throw new InvalidSettingError('mode', mode, getAvailableModes());
    }

    try {
      await this.adapter!.write(cmd);
    } catch (e) {
      throw new CommandError(`Failed to set mode: ${this.getErrorMessage(e)}`, 'setMode');
    }
  }

  /**
   * Get available training modes.
   */
  getAvailableModes(): TrainingMode[] {
    return getAvailableModes();
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

      await this.adapter!.write(Workout.PREPARE);
      await delay(200);
      await this.adapter!.write(Workout.SETUP);
      await delay(300);

      this.setRecordingState('ready');
    } catch (e) {
      this.setRecordingState('idle');
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
      await this.adapter!.write(Workout.GO);
      this.setRecordingState('active');
    } catch (e) {
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
        await this.adapter.write(Workout.STOP);
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
      await this.adapter!.write(Workout.STOP);
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
   * Subscribe to rep boundary events.
   * Called when the device signals a rep completion (end of concentric or eccentric phase).
   *
   * @param listener Rep boundary listener
   * @returns Unsubscribe function
   */
  onRepBoundary(listener: RepBoundaryListener): () => void {
    this.repBoundaryListeners.add(listener);
    return () => this.repBoundaryListeners.delete(listener);
  }

  /**
   * Subscribe to set boundary events.
   * Called when the device signals set completion.
   *
   * @param listener Set boundary listener
   * @returns Unsubscribe function
   */
  onSetBoundary(listener: SetBoundaryListener): () => void {
    this.setBoundaryListeners.add(listener);
    return () => this.setBoundaryListeners.delete(listener);
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
   * @param listener Settings update listener
   * @returns Unsubscribe function
   */
  onSettingsUpdate(listener: SettingsUpdateListener): () => void {
    this.settingsUpdateListeners.add(listener);
    return () => this.settingsUpdateListeners.delete(listener);
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
    this.repBoundaryListeners.clear();
    this.setBoundaryListeners.clear();
    this.modeConfirmedListeners.clear();
    this.settingsUpdateListeners.clear();
    this.batteryUpdateListeners.clear();

    // Cleanup
    this.cleanup();
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
      onFrame: (frame) => {
        this.emit({ type: 'frame', frame });
        this.frameListeners.forEach((listener) => listener(frame));
      },
      onRepBoundary: () => {
        this.emit({ type: 'repBoundary' });
        this.repBoundaryListeners.forEach((listener) => listener());
      },
      onSetBoundary: () => {
        this.emit({ type: 'setBoundary' });
        this.setBoundaryListeners.forEach((listener) => listener());
      },
      onModeConfirmed: (mode) => {
        this.emit({ type: 'modeConfirmed', mode });
        this.modeConfirmedListeners.forEach((listener) => listener(mode));
      },
      onSettingsUpdate: (settings) => {
        this.emit({ type: 'settingsUpdate', settings });
        this.settingsUpdateListeners.forEach((listener) => listener(settings));
        this.syncSettingsFromDevice(settings);
      },
      onBatteryUpdate: (battery) => {
        this.emit({ type: 'batteryUpdate', battery });
        this.batteryUpdateListeners.forEach((listener) => listener(battery));
      },
    });

    this.notificationUnsubscribe = this.adapter.onNotification(handler);
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
    this._settings = { ...DEFAULT_SETTINGS };
    this._recordingState = 'idle';
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
  }
}
