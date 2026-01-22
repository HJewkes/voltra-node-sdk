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

import type { BLEAdapter, NotificationCallback } from '../bluetooth/adapters/types';
import type { DiscoveredDevice } from '../bluetooth/models/device';
import type { VoltraConnectionState } from '../voltra/models/connection';
import type { VoltraDeviceSettings, VoltraRecordingState } from '../voltra/models/device';
import { isValidVoltraTransition } from '../voltra/models/connection';
import { filterVoltraDevices } from '../voltra/models/device-filter';
import { Auth, Init, Timing, Workout } from '../voltra/protocol/constants';
import { WeightCommands, ChainsCommands, EccentricCommands } from '../voltra/protocol/commands';
import { decodeNotification } from '../voltra/protocol/telemetry-decoder';
import { delay } from '../shared/utils';
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
  ScanOptions,
} from './types';

/**
 * Default client options.
 */
const DEFAULT_OPTIONS: Required<Omit<VoltraClientOptions, 'adapter'>> = {
  autoReconnect: false,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
};

/**
 * Default device settings.
 */
const DEFAULT_SETTINGS: VoltraDeviceSettings = {
  weight: 0,
  chains: 0,
  eccentric: 0,
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
   * @param lbs Weight (5-200 in increments of 5)
   */
  async setWeight(lbs: number): Promise<void> {
    this.ensureConnected();

    const cmd = WeightCommands.get(lbs);
    if (!cmd) {
      throw new InvalidSettingError('weight', lbs, WeightCommands.getAvailable());
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

    const cmds = ChainsCommands.get(lbs);
    if (!cmds) {
      throw new InvalidSettingError('chains', lbs, ChainsCommands.getAvailable());
    }

    try {
      await this.adapter!.write(cmds.step1);
      await delay(Timing.DUAL_COMMAND_DELAY_MS);
      await this.adapter!.write(cmds.step2);
      this._settings.chains = lbs;
    } catch (e) {
      throw new CommandError(`Failed to set chains: ${this.getErrorMessage(e)}`, 'setChains');
    }
  }

  /**
   * Set eccentric load adjustment.
   *
   * @param percent Eccentric adjustment (-195 to +195)
   */
  async setEccentric(percent: number): Promise<void> {
    this.ensureConnected();

    const cmds = EccentricCommands.get(percent);
    if (!cmds) {
      throw new InvalidSettingError('eccentric', percent, EccentricCommands.getAvailable());
    }

    try {
      await this.adapter!.write(cmds.step1);
      await delay(Timing.DUAL_COMMAND_DELAY_MS);
      await this.adapter!.write(cmds.step2);
      this._settings.eccentric = percent;
    } catch (e) {
      throw new CommandError(`Failed to set eccentric: ${this.getErrorMessage(e)}`, 'setEccentric');
    }
  }

  /**
   * Get available weight values.
   */
  getAvailableWeights(): number[] {
    return WeightCommands.getAvailable();
  }

  /**
   * Get available chains values.
   */
  getAvailableChains(): number[] {
    return ChainsCommands.getAvailable();
  }

  /**
   * Get available eccentric values.
   */
  getAvailableEccentric(): number[] {
    return EccentricCommands.getAvailable();
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

    // Clear listeners
    this.listeners.clear();
    this.frameListeners.clear();

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

    const handler: NotificationCallback = (data) => {
      const result = decodeNotification(data);
      if (!result) return;

      if (result.type === 'frame') {
        this.emit({ type: 'frame', frame: result.frame });
        this.frameListeners.forEach((listener) => listener(result.frame));
      }
    };

    this.notificationUnsubscribe = this.adapter.onNotification(handler);
  }

  private setupDisconnectHandler(): void {
    if (!this.adapter || !this.options.autoReconnect) return;

    // Monitor connection state
    const checkConnection = this.adapter.onConnectionStateChange?.((state) => {
      if (state === 'disconnected' && this._connectionState === 'connected') {
        this.handleUnexpectedDisconnect();
      }
    });

    // Store for cleanup if the adapter supports it
    if (checkConnection) {
      const originalUnsubscribe = this.notificationUnsubscribe;
      this.notificationUnsubscribe = () => {
        originalUnsubscribe?.();
        checkConnection();
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

    while (this._reconnectAttempt < this.options.maxReconnectAttempts) {
      this._reconnectAttempt++;
      this.emit({
        type: 'reconnecting',
        attempt: this._reconnectAttempt,
        maxAttempts: this.options.maxReconnectAttempts,
      });

      try {
        await delay(this.options.reconnectDelayMs);
        await this.connect(this._lastConnectedDevice);
        this._isReconnecting = false;
        return;
      } catch {
        // Continue to next attempt
      }
    }

    // Reconnect failed
    this._isReconnecting = false;
    this.cleanup();
    this.setConnectionState('disconnected');
    this.emit({ type: 'disconnected', deviceId: this._connectedDeviceId ?? 'unknown' });
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
      throw new Error('No adapter configured. Call setAdapter() or provide adapter in constructor.');
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
}
