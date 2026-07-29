/**
 * @voltras/node-sdk — React Native entry point.
 *
 * Everything reachable from this module is Metro-safe: no Node built-ins,
 * no `webbluetooth`, no `@stoprocent/noble`. `react-native-ble-plx` IS
 * reached, deliberately — it is the backend a React Native app runs on.
 *
 * WHY THIS EXISTS. Making the platform-switching manager's `require()`
 * calls opaque (VW-101) was necessary but NOT sufficient: the package root
 * has a SECOND path to the Node backends. `src/index.ts` value-exports
 * `createBLEAdapter` from `../bluetooth/adapters`, and that barrel
 * statically re-exports `NobleHost` from `./node-noble`. So a React Native
 * bundle reached `@stoprocent/noble` -> `node:os` through the barrel even
 * with the manager fixed, and failed with "Unable to resolve module os".
 * Fixing one door does not help while the other stands open — which is why
 * the acceptance test here is a real Metro bundle, not a module-graph
 * argument.
 *
 * This mirrors `entries/web.ts` exactly, including its guard test. The
 * `react-native` export condition in `package.json` resolves the package
 * ROOT here, so app code keeps writing `from '@voltras/node-sdk'`.
 *
 * @example
 * ```typescript
 * import { VoltraManager } from '@voltras/node-sdk';
 *
 * const manager = new VoltraManager();
 * const client = await manager.connectFirst();
 * await client.setWeight(50);
 * ```
 */

import type { AdapterFactory, Platform, VoltraManagerOptions } from '../sdk/manager-core';
import { VoltraManagerCore } from '../sdk/manager-core';
import type { BluetoothHost } from '../bluetooth/adapters/types';
import { LegacyAdapterHost } from '../bluetooth/adapters/legacy-shim';
import { NativeBLEAdapter } from '../bluetooth/adapters/native';
import { MockBLEAdapter } from '../bluetooth/adapters/mock';
import { BLE } from '../voltra/protocol/constants';

// =============================================================================
// Manager
// =============================================================================

/**
 * React Native manager. Native-only sibling of `VoltraManager`.
 *
 * Platform detection is fixed to `'native'` — a React Native bundle has no
 * other runtime to detect, and the old runtime probe was the source of a
 * real bug where `typeof window !== 'undefined'` matched on a device and
 * selected Web Bluetooth. The host is always a `LegacyAdapterHost` around
 * the `react-native-ble-plx` adapter.
 *
 * `mock` remains selectable, because the mock adapter has no peer
 * dependencies and mock-driven development on a simulator is a real
 * workflow. Every OTHER platform is absent by construction rather than by
 * a runtime throw: `node` and `node-noble` cannot be named here at all.
 */
export class VoltraNativeManager extends VoltraManagerCore {
  /**
   * Create a manager for React Native.
   */
  static forNative(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraNativeManager {
    return new VoltraNativeManager({ ...options, platform: 'native' });
  }

  protected detectPlatform(): Platform {
    return 'native';
  }

  protected createAdapterFactory(platform: Platform): AdapterFactory {
    // Map BLE constant (SCREAMING_SNAKE_CASE) to BLEServiceConfig (camelCase).
    // `deviceNamePrefix` is undefined unless the consumer opted in — see
    // `VoltraManagerOptions.deviceNamePrefix`.
    const bleConfig = {
      serviceUUID: BLE.SERVICE_UUID,
      notifyCharUUID: BLE.NOTIFY_CHAR_UUID,
      writeCharUUID: BLE.WRITE_CHAR_UUID,
      deviceNamePrefix: this.deviceNamePrefix,
    };

    // Both imported statically: Metro resolves `react-native-ble-plx`
    // natively, and the mock has no peer dependencies. There is nothing
    // here to lazy-load and nothing for Metro to choke on.
    if (platform === 'mock') return () => new MockBLEAdapter();
    return () => new NativeBLEAdapter({ ble: bleConfig });
  }

  protected createHost(_platform: Platform, factory: AdapterFactory): BluetoothHost {
    return new LegacyAdapterHost(factory);
  }
}

/**
 * Alias so React Native code can `import { VoltraManager }` unchanged.
 *
 * `package.json`'s `react-native` export condition resolves the package
 * root to this entry, so a Metro bundle gets the native manager rather than
 * the platform-switching one — whose module graph reaches the Node BLE
 * stack through the adapters barrel.
 *
 * This deliberately does NOT carry `forNode`/`forWeb`/`forNodeNoble`:
 * those platforms do not exist on a phone.
 */
export { VoltraNativeManager as VoltraManager };

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

export { NativeBLEAdapter } from '../bluetooth/adapters/native';
export type { NativeAdapterConfig } from '../bluetooth/adapters/native';
export { VoltraClient } from '../sdk/voltra-client';

export {
  MockBLEAdapter,
  type MockBLEConfig,
  type MockSessionConfig,
  type PlannedRepProfile,
  createMultiSetScenario,
  createPauseSetScenario,
  createTempoScenario,
  createShortRestScenario,
} from '../bluetooth/adapters/mock';

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
