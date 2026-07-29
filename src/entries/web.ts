/**
 * @voltras/node-sdk/web
 *
 * Browser entry point. Everything reachable from this module is
 * bundler-safe: no Node built-ins, no `webbluetooth`, no
 * `@stoprocent/noble`, no `react-native-ble-plx`, and no CommonJS
 * `require` calls.
 *
 * Use `VoltraWebManager` instead of `VoltraManager` in browser apps. It is
 * the same manager (both extend `VoltraManagerCore`) with the platform
 * hooks hard-wired to Web Bluetooth, so importing it never pulls the
 * Node/native adapter graph into the bundle.
 *
 * @example
 * ```typescript
 * import { VoltraWebManager } from '@voltras/node-sdk/web';
 *
 * const manager = new VoltraWebManager();
 * const client = await manager.connectFirst();
 * await client.setWeight(50);
 * ```
 */

import type { AdapterFactory, Platform, VoltraManagerOptions } from '../sdk/manager-core';
import { VoltraManagerCore } from '../sdk/manager-core';
import type { BluetoothHost } from '../bluetooth/adapters/types';
import { LegacyAdapterHost } from '../bluetooth/adapters/legacy-shim';
import { WebBLEAdapter } from '../bluetooth/adapters/web';
import { MockBLEAdapter, type MockBLEConfig } from '../bluetooth/adapters/mock';
import { BLE } from '../voltra/protocol/constants';

// =============================================================================
// Manager
// =============================================================================

/**
 * Web Bluetooth manager. Browser-only sibling of `VoltraManager`.
 *
 * Platform detection is fixed to `'web'` — a browser bundle has no other
 * runtime to detect — and the host is always a `LegacyAdapterHost` around
 * the Web Bluetooth adapter.
 */
export class VoltraWebManager extends VoltraManagerCore {
  /**
   * Create a manager for web browsers.
   */
  static forWeb(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraWebManager {
    return new VoltraWebManager({ ...options, platform: 'web' });
  }

  /**
   * Create a manager with a mock adapter for testing / visual development.
   *
   * This class documented `forMock()` as working from 0.12.0 but never
   * declared it — `forMock` was a static on the CONCRETE `VoltraManager`
   * only, so calling it through the `browser` export condition was a type
   * error, and `new VoltraWebManager({ platform: 'mock' })` silently built a
   * Web Bluetooth adapter because `createAdapterFactory` ignored the
   * platform. Both halves fixed here.
   */
  static forMock(config?: MockBLEConfig): VoltraWebManager {
    return new VoltraWebManager({
      platform: 'mock',
      adapterFactory: () => new MockBLEAdapter(config),
    });
  }

  protected detectPlatform(): Platform {
    return 'web';
  }

  protected createAdapterFactory(_platform: Platform): AdapterFactory {
    // Map BLE constant (SCREAMING_SNAKE_CASE) to BLEServiceConfig (camelCase).
    // `deviceNamePrefix` is undefined unless the consumer opted in — see
    // `VoltraManagerOptions.deviceNamePrefix`.
    const bleConfig = {
      serviceUUID: BLE.SERVICE_UUID,
      notifyCharUUID: BLE.NOTIFY_CHAR_UUID,
      writeCharUUID: BLE.WRITE_CHAR_UUID,
      deviceNamePrefix: this.deviceNamePrefix,
    };

    // Imported statically: the web adapter has no peer dependencies, so
    // there is nothing to lazy-load and nothing for a bundler to choke on.
    return () => new WebBLEAdapter({ ble: bleConfig });
  }

  protected createHost(_platform: Platform, factory: AdapterFactory): BluetoothHost {
    return new LegacyAdapterHost(factory);
  }
}

/**
 * Alias so browser code can `import { VoltraManager }` unchanged.
 *
 * `package.json`'s `browser` export condition resolves the package root to
 * this entry, so a bundler targeting the browser gets the Web Bluetooth
 * manager rather than the platform-switching one — whose `require()` calls
 * cannot be bundled and drag in the Node BLE stack.
 *
 * This deliberately does NOT carry `forNode`/`forNative`/`forNodeNoble`:
 * those platforms do not exist in a browser. `forWeb()` and `forMock()`
 * behave as before.
 */
export { VoltraWebManager as VoltraManager };

export type {
  Platform,
  AdapterFactory,
  VoltraManagerOptions,
  ConnectByNameOptions,
  VoltraManagerEvent,
  VoltraManagerEventListener,
} from '../sdk/manager-core';

// =============================================================================
// Client + Adapters
// =============================================================================

export { WebBLEAdapter } from '../bluetooth/adapters/web';
export { VoltraClient } from '../sdk/voltra-client';

export type {
  VoltraClientOptions,
  VoltraClientState,
  VoltraClientEvent,
  VoltraClientEventListener,
  ScanOptions,
  FrameListener,
  RawFrameListener,
  ModeConfirmedListener,
  SettingsUpdateListener,
  StateDumpListener,
  BatteryUpdateListener,
  ConnectionStateListener,
  PerRepEvent,
  SummaryEvent,
  SetSummaryEvent,
  InProgressEvent,
  PerRepListener,
  SummaryListener,
  SetSummaryListener,
  InProgressListener,
  RowingDistancePreset,
  GuidedLoadOptions,
  GuidedLoadState,
  GuidedLoadPhase,
  GuidedLoadStateListener,
  SettingsFieldChangedEvent,
  // Phase 6 event wrappers — envelope + bare payload shapes + aliases
  PhaseSixEventEnvelope,
  BatteryUpdate,
  RawFrame,
  ModeChange,
  ConnectionStateChange,
  ConnectionLoss,
  GuidedLoadStatePayload,
  ModeRevert,
  BatteryUpdateEvent,
  RawFrameEvent,
  ModeChangeEvent,
  ConnectionStateChangeEvent,
  ConnectionLossEvent,
  GuidedLoadStateEvent,
  ModeRevertEvent,
  BatteryUpdateEventListener,
  RawFrameEventListener,
  ModeChangeEventListener,
  ConnectionStateChangeEventListener,
  ConnectionLossEventListener,
  GuidedLoadStateEventListener,
  ModeRevertEventListener,
} from '../sdk/types';

export { setMockActivation, isMockActivated } from '../sdk/mock-activation';

// =============================================================================
// Adapter Types + Host/Peripheral Split
// =============================================================================

export type {
  BLEAdapter,
  BLEServiceConfig,
  ConnectOptions,
  ConnectionState,
  NotificationCallback,
  ConnectionStateCallback,
  BluetoothHost,
  Peripheral,
  Discovery,
  PeripheralStatus,
  PeripheralStatusCallback,
  PeripheralWriteOptions,
  HostScanOptions,
} from '../bluetooth/adapters/types';
export { PeripheralLost, PeripheralRebound } from '../bluetooth/adapters/types';
export { LegacyAdapterHost, LegacyAdapterPeripheral } from '../bluetooth/adapters/legacy-shim';
export type { LegacyAdapterHostOptions } from '../bluetooth/adapters/legacy-shim';

// =============================================================================
// Device Discovery
// =============================================================================

export type { DiscoveredDevice } from '../bluetooth/models/device';
export { getDeviceDisplayName, sortBySignalStrength } from '../bluetooth/models/device';

export {
  VOLTRA_DEVICE_PREFIX,
  DEVICE_NAME_PREFIX_ENV_VAR,
  resolveDeviceNamePrefix,
  isVoltraDevice,
  filterVoltraDevices,
} from '../voltra/models/device-filter';

// =============================================================================
// Voltra Device Types
// =============================================================================

export type {
  VoltraDeviceSettings,
  VoltraRecordingState,
  VoltraDeviceState,
} from '../voltra/models/device';

export type { VoltraConnectionState } from '../voltra/models/connection';

export type { DeviceSettings, StateDumpEvent } from '../voltra/protocol/types';

// =============================================================================
// Telemetry
// =============================================================================

export type { TelemetryFrame } from '../voltra/models/telemetry';
export { createFrame } from '../voltra/models/telemetry';

export {
  decodeTelemetryFrame,
  decodeNotification,
  encodeTelemetryFrame,
  identifyMessageType,
  decodeVendorPerRep,
  decodeVendorSummary,
  decodeVendorSetSummary,
  decodeVendorInProgress,
  type DecodeResult,
  type MessageType,
} from '../voltra/protocol/telemetry-decoder';

export type {
  RowingSummaryEvent,
  RowingStatusEvent,
  WaveformChunkEvent,
} from '../voltra/protocol/types';

export {
  MovementPhase,
  PhaseNames,
  MessageTypes,
  VendorMessages,
  matchesVendorSubType,
  TelemetryOffsets,
  ParameterId,
  ParameterNames,
  TrainingMode,
  TrainingModeNames,
  VALID_TRAINING_MODES,
  VendorSchemaVersion,
} from '../voltra/protocol/constants';

// =============================================================================
// Commands
// =============================================================================

export {
  getWeightCommand,
  getChainsCommand,
  getEccentricCommand,
  getInverseChainsCommand,
  getModeCommand,
  getAvailableWeights,
  getAvailableChains,
  getAvailableEccentric,
  getAvailableInverseChains,
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
  getTelemetrySubscribeCommand,
  getCableTriggerCommand,
  getResistanceExperienceCommand,
  getAvailableTelemetryRates,
} from '../voltra/protocol/commands';

// =============================================================================
// Protocol Constants
// =============================================================================

export { BLE, Timing, Auth, Init, Workout } from '../voltra/protocol/constants';

// =============================================================================
// Errors
// =============================================================================

export {
  VoltraSDKError,
  ConnectionError,
  AuthenticationError,
  TimeoutError,
  NotConnectedError,
  InvalidSettingError,
  BluetoothUnavailableError,
  CommandError,
  TelemetryError,
  ErrorCode,
  type ErrorCode as ErrorCodeType,
} from '../errors';

// =============================================================================
// Utilities
// =============================================================================

export { delay } from '../shared/utils';
export { setDebugEnabled } from '../shared/logger';
