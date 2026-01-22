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
  ScanOptions,
  DeviceChooser,
} from './types';

export type {
  Platform,
  VoltraManagerOptions,
  VoltraManagerEvent,
  VoltraManagerEventListener,
  ConnectByNameOptions,
  AdapterFactory,
} from './voltra-manager';
