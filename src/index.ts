/**
 * @voltras/node-sdk
 *
 * SDK for connecting to and controlling Voltra fitness devices.
 *
 * Use VoltraManager as the main entry point. It handles device discovery
 * and returns VoltraClient instances for controlling individual devices.
 *
 * @example
 * ```typescript
 * import { VoltraManager } from '@voltras/node-sdk';
 *
 * // Create manager (auto-detects platform for web/node)
 * const manager = new VoltraManager();
 *
 * // Scan and connect
 * const devices = await manager.scan();
 * const client = await manager.connect(devices[0]);
 *
 * // Or connect by name in one step
 * const client = await manager.connectByName('VTR-123456');
 *
 * // Control the device
 * await client.setWeight(50);
 * client.onFrame((frame) => console.log('Position:', frame.position));
 * await client.startRecording();
 * ```
 *
 * For React Native, specify the platform:
 * ```typescript
 * const manager = VoltraManager.forNative();
 * // or
 * const manager = new VoltraManager({ platform: 'native' });
 * ```
 */

// =============================================================================
// High-Level API
// =============================================================================

export {
  VoltraClient,
  VoltraManager,
  type Platform,
  type VoltraClientOptions,
  type VoltraClientState,
  type VoltraClientEvent,
  type VoltraClientEventListener,
  type VoltraManagerOptions,
  type VoltraManagerEvent,
  type VoltraManagerEventListener,
  type ConnectByNameOptions,
  type AdapterFactory,
  type FrameListener,
  type RawFrameListener,
  type PerRepEvent,
  type SummaryEvent,
  type SetSummaryEvent,
  type InProgressEvent,
  type PerRepListener,
  type SummaryListener,
  type SetSummaryListener,
  type InProgressListener,
  type ModeConfirmedListener,
  type SettingsUpdateListener,
  type StateDumpListener,
  type BatteryUpdateListener,
  type ConnectionStateListener,
  type ScanOptions,
  type RowingDistancePreset,
  type GuidedLoadOptions,
  type GuidedLoadState,
  type GuidedLoadPhase,
  type GuidedLoadStateListener,
  type SettingsFieldChangedEvent,
  // Phase 6 event wrappers — envelope + bare payload shapes + aliases
  type PhaseSixEventEnvelope,
  type BatteryUpdate,
  type RawFrame,
  type ModeChange,
  type ConnectionStateChange,
  type ConnectionLoss,
  type GuidedLoadStatePayload,
  type ModeRevert,
  type BatteryUpdateEvent,
  type RawFrameEvent,
  type ModeChangeEvent,
  type ConnectionStateChangeEvent,
  type ConnectionLossEvent,
  type GuidedLoadStateEvent,
  type ModeRevertEvent,
  type BatteryUpdateEventListener,
  type RawFrameEventListener,
  type ModeChangeEventListener,
  type ConnectionStateChangeEventListener,
  type ConnectionLossEventListener,
  type GuidedLoadStateEventListener,
  type ModeRevertEventListener,
} from './sdk';

// =============================================================================
// Platform Adapters
// =============================================================================

// Platform adapter classes are exported as TYPE-ONLY from the root entry to
// avoid eagerly loading platform-specific peer dependencies (e.g.
// `react-native-ble-plx`, `noble`) when a consumer only needs typing or
// uses the high-level `VoltraManager.forX()` factories. To get the
// adapter class as a value (for `new NativeBLEAdapter(...)`), import via
// the subpath: `@voltras/node-sdk/native`, `@voltras/node-sdk/node`, etc.
export type { WebBLEAdapter } from './bluetooth/adapters/web';
export type { NodeBLEAdapter, DeviceChooser } from './bluetooth/adapters/node';
export type { NativeBLEAdapter } from './bluetooth/adapters/native';
// MockBLEAdapter has no platform-specific peers, so it stays as a value
// export — `forMock()` already eagerly imports it.
export {
  MockBLEAdapter,
  type MockBLEConfig,
  type MockSessionConfig,
  type PlannedRepProfile,
  createMultiSetScenario,
  createPauseSetScenario,
  createTempoScenario,
  createShortRestScenario,
} from './bluetooth/adapters/mock';
// ReplayBLEAdapter has no platform-specific peers either — value export OK.
// Also reachable via the `@voltras/node-sdk/testing` subpath alongside Mock.
export { ReplayBLEAdapter, type ReplayBLEAdapterOptions } from './bluetooth/adapters/replay';
export { createBLEAdapter } from './bluetooth/adapters';

// Adapter types (what consumers need to implement or use)
export type {
  BLEAdapter,
  BLEServiceConfig,
  ConnectOptions,
  ConnectionState,
  NotificationCallback,
  ConnectionStateCallback,
} from './bluetooth/adapters/types';

// Phase 0 (2026-05-08): BluetoothHost + Peripheral split. New shape
// alongside the legacy `BLEAdapter` — see
// coordination/architecture/ble-adapter-refactor-2026-05-08.md.
export type {
  BluetoothHost,
  Peripheral,
  Discovery,
  PeripheralStatus,
  PeripheralStatusCallback,
  PeripheralWriteOptions,
  HostScanOptions,
} from './bluetooth/adapters/types';
export { PeripheralLost, PeripheralRebound } from './bluetooth/adapters/types';
export { LegacyAdapterHost, LegacyAdapterPeripheral } from './bluetooth/adapters/legacy-shim';
export type { LegacyAdapterHostOptions } from './bluetooth/adapters/legacy-shim';

// Phase 1 (2026-05-08): noble-backed Node host + peripheral. Type-only
// at the root entry to avoid eagerly loading `@stoprocent/noble` for
// consumers that don't opt in. Get the values via `VoltraManager.forNodeNoble()`
// or via the `@voltras/node-sdk/node-noble` subpath.
export type {
  NobleHost,
  NoblePeripheral,
  NobleHostConfig,
  NobleBindingType,
  NoblePeripheralLike,
  NobleCharacteristicLike,
  NobleLike,
} from './bluetooth/adapters/node-noble';

// =============================================================================
// Device Discovery
// =============================================================================

export type { DiscoveredDevice } from './bluetooth/models/device';
export { getDeviceDisplayName, sortBySignalStrength } from './bluetooth/models/device';

export {
  VOLTRA_DEVICE_PREFIX,
  isVoltraDevice,
  filterVoltraDevices,
} from './voltra/models/device-filter';

// =============================================================================
// Voltra Device Types
// =============================================================================

export type {
  VoltraDeviceSettings,
  VoltraRecordingState,
  VoltraDeviceState,
} from './voltra/models/device';

export type { VoltraConnectionState } from './voltra/models/connection';

// DeviceSettings is the protocol-level settings type used in event payloads
// (SettingsUpdateListener, StateDumpEvent). Exported here so consumers can
// type their event listener callbacks without reaching into subpaths.
export type { DeviceSettings } from './voltra/protocol/types';

// =============================================================================
// Telemetry
// =============================================================================

export type { TelemetryFrame } from './voltra/models/telemetry';
export { createFrame } from './voltra/models/telemetry';

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
} from './voltra/protocol/telemetry-decoder';

// Rowing telemetry event payload types (HYPOTHESIS — pending on-device validation
// in a future Rowing-mode session). The decoder functions that produce these are
// already exported above via `decodeNotification` / `decodeVendorPerRep` et al.
export type {
  RowingSummaryEvent,
  RowingStatusEvent,
  WaveformChunkEvent,
} from './voltra/protocol/types';

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
} from './voltra/protocol/constants';

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
} from './voltra/protocol/commands';

// =============================================================================
// Protocol Constants
// =============================================================================

export { BLE, Timing, Auth, Init, Workout } from './voltra/protocol/constants';

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
} from './errors';

// =============================================================================
// Utilities
// =============================================================================

export { delay } from './shared/utils';
export { setDebugEnabled } from './shared/logger';
