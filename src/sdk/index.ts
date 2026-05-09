/**
 * SDK - High-level API
 *
 * VoltraManager is the main entry point. It handles device discovery and returns
 * VoltraClient instances for controlling individual devices.
 */

export { VoltraClient } from './voltra-client';
export { VoltraManager } from './voltra-manager';

export type {
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
  ConnectionStateListener,
  PerRepEvent,
  SummaryEvent,
  SetSummaryEvent,
  InProgressEvent,
  PerRepListener,
  SummaryListener,
  SetSummaryListener,
  InProgressListener,
  ScanOptions,
  RowingDistancePreset,
  GuidedLoadOptions,
  GuidedLoadState,
  GuidedLoadPhase,
  GuidedLoadStateListener,
  SettingsFieldChangedEvent,
  // Phase 6 event wrappers
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
} from './types';

// Re-export DeviceSettings + StateDumpEvent for typing event listeners
export type { DeviceSettings, StateDumpEvent } from '../voltra/protocol/types';

// DeviceChooser is canonical in the adapter layer; re-export from there to
// avoid duplicate declarations.
export type { DeviceChooser } from '../bluetooth/adapters/node';

export type {
  Platform,
  VoltraManagerOptions,
  VoltraManagerEvent,
  VoltraManagerEventListener,
  ConnectByNameOptions,
  AdapterFactory,
} from './voltra-manager';
