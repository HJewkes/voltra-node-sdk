/**
 * SDK - High-level API
 *
 * Exports the VoltraClient, VoltraManager, and related types for device interaction.
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
  VoltraManagerOptions,
  VoltraManagerEvent,
  VoltraManagerEventListener,
  DeviceConnectedCallback,
  DeviceDisconnectedCallback,
  AdapterFactory,
} from './voltra-manager';
