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
  ModeConfirmedListener,
  SettingsUpdateListener,
  BatteryUpdateListener,
  PerRepEvent,
  SummaryEvent,
  PreSummaryEvent,
  InProgressEvent,
  PerRepListener,
  SummaryListener,
  PreSummaryListener,
  InProgressListener,
  ScanOptions,
  DeviceChooser,
  RowingDistancePreset,
  GuidedLoadOptions,
  GuidedLoadState,
  GuidedLoadPhase,
  GuidedLoadStateListener,
} from './types';

// Re-export DeviceSettings for typing event listeners
export type { DeviceSettings } from '../voltra/protocol/types';

export type {
  Platform,
  VoltraManagerOptions,
  VoltraManagerEvent,
  VoltraManagerEventListener,
  ConnectByNameOptions,
  AdapterFactory,
} from './voltra-manager';
