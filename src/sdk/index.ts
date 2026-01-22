/**
 * SDK - High-level API
 *
 * Exports the VoltraClient and related types for simplified device interaction.
 */

export { VoltraClient } from './voltra-client';

export type {
  VoltraClientOptions,
  VoltraClientState,
  VoltraClientEvent,
  VoltraClientEventListener,
  FrameListener,
  ScanOptions,
  DeviceChooser,
} from './types';
