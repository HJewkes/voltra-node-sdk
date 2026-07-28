/**
 * VoltraManager
 *
 * Main entry point for the Voltra SDK. Handles device discovery and connection.
 * Returns VoltraClient instances for controlling individual devices.
 *
 * All platform-agnostic behavior lives in `VoltraManagerCore`
 * (`./manager-core`). This file adds only the platform-bound pieces:
 * runtime detection and the lazily-`require()`d platform adapters. Keeping
 * the `require()` calls confined here is what lets `manager-core.ts` (and
 * the browser entry built on it) bundle without Node dependencies.
 *
 * @example
 * ```typescript
 * import { VoltraManager } from '@voltras/node-sdk';
 *
 * const manager = new VoltraManager();
 *
 * // Scan for devices
 * const devices = await manager.scan();
 *
 * // Connect to a device (returns a VoltraClient)
 * const client = await manager.connect(devices[0]);
 *
 * // Or connect by name (scans + connects in one step)
 * const client = await manager.connectByName('VTR-123456');
 *
 * // Use the client
 * await client.setWeight(50);
 * client.onFrame((frame) => console.log(frame.position));
 *
 * // Cleanup
 * manager.dispose();
 * ```
 */

import type { BluetoothHost } from '../bluetooth/adapters/types';
import { LegacyAdapterHost } from '../bluetooth/adapters/legacy-shim';
import { MockBLEAdapter, type MockBLEConfig } from '../bluetooth/adapters/mock';
import { isMockActivated } from './mock-activation';
import { BLE } from '../voltra/protocol/constants';
import { VoltraManagerCore, type Platform, type AdapterFactory } from './manager-core';
import type { VoltraManagerOptions } from './manager-core';

// Shared manager types live in `manager-core` now; re-exported here so
// existing `from './voltra-manager'` import sites keep working.
export type {
  Platform,
  AdapterFactory,
  VoltraManagerOptions,
  ConnectByNameOptions,
  VoltraManagerEvent,
  VoltraManagerEventListener,
} from './manager-core';

/**
 * Main entry point for the Voltra SDK.
 */
export class VoltraManager extends VoltraManagerCore {
  // ===========================================================================
  // Static Factory Methods
  // ===========================================================================

  /**
   * Create a manager for web browsers.
   */
  static forWeb(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraManager {
    return new VoltraManager({ ...options, platform: 'web' });
  }

  /**
   * Create a manager for Node.js (legacy `webbluetooth` backend).
   *
   * Default Node platform. Affected by the upstream SimplebleAdapter
   * singleton cross-talk bug when driving 2+ peripherals concurrently.
   * For multi-peripheral safety prefer `forNodeNoble()` (Phase 1).
   */
  static forNode(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraManager {
    return new VoltraManager({ ...options, platform: 'node' });
  }

  /**
   * Create a manager for Node.js using the `@stoprocent/noble` backend.
   *
   * Phase 1 (2026-05-08) opt-in alternative to `forNode()`. Implements
   * the BluetoothHost/Peripheral split with per-instance noble peripheral
   * handles, so multi-device cross-talk is impossible at the library
   * layer. Will be promoted to the default Node platform in Phase 4 after
   * bilateral on-hardware validation.
   *
   * Requires `@stoprocent/noble` installed. macOS: terminal must hold
   * Bluetooth permission. See research doc §4 for caveats.
   */
  static forNodeNoble(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraManager {
    return new VoltraManager({ ...options, platform: 'node-noble' });
  }

  /**
   * Create a manager for React Native.
   * Note: Prefer importing from '@voltras/node-sdk/native' instead.
   */
  static forNative(options?: Omit<VoltraManagerOptions, 'platform'>): VoltraManager {
    return new VoltraManager({ ...options, platform: 'native' });
  }

  /**
   * Create a manager with a mock adapter for testing/visual development.
   * Simulates a connected Voltra device with realistic telemetry.
   */
  static forMock(config?: MockBLEConfig): VoltraManager {
    return new VoltraManager({
      platform: 'mock',
      adapterFactory: () => new MockBLEAdapter(config),
    });
  }

  // ===========================================================================
  // Platform Hooks
  // ===========================================================================

  protected detectPlatform(): Platform {
    // Mock activation (VOLTRA_MOCK env var or setMockActivation()) forces
    // the mock adapter regardless of the real runtime. This is how native
    // and Node builds opt into mock without the web-only `?mock` URL param.
    // An explicit platform/adapterFactory/host bypasses detection entirely.
    if (isMockActivated()) {
      return 'mock';
    }

    // Check for browser environment
    if (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      'bluetooth' in navigator
    ) {
      return 'web';
    }

    // Check for Node.js environment.
    //
    // Resolves to 'node-noble' (Phase 4 promotion, 2026-07-28). The legacy
    // 'node' backend is multi-peripheral-unsafe and its picker-style scan
    // returns only the first device that advertises, so it cannot
    // enumerate. Opt into it explicitly with `VoltraManager.forNode()`.
    if (typeof process !== 'undefined' && process.versions?.node) {
      return 'node-noble';
    }

    // Default to native (React Native)
    // Note: This fallback may not work well - users should specify platform
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

    switch (platform) {
      case 'web':
        return () => {
          // Dynamic require to avoid eager-loading platform peers.
          // In the ESM build a `require` shim is prepended at build time
          // (see scripts/inject-esm-require-shim.mjs) so this works in
          // both CommonJS and ECMAScript module contexts.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { WebBLEAdapter } = require('../bluetooth/adapters/web');
          return new WebBLEAdapter({ ble: bleConfig });
        };

      case 'node':
        return () => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { NodeBLEAdapter } = require('../bluetooth/adapters/node');
          return new NodeBLEAdapter({ ble: bleConfig });
        };

      case 'native':
        return () => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { NativeBLEAdapter } = require('../bluetooth/adapters/native');
          return new NativeBLEAdapter({ ble: bleConfig });
        };

      case 'mock':
        // Mock has no platform-specific peer deps, so it's imported
        // eagerly at module top (same as `forMock()`) rather than via a
        // dynamic require.
        return () => new MockBLEAdapter();

      case 'node-noble':
        // node-noble drives a `BluetoothHost` directly (built in
        // `createHost()`); the legacy adapter factory is unused.
        // Return a stub that throws if anything reaches it — that would
        // mean a code path bypassed the host route, which is a bug.
        return () => {
          throw new Error(
            "platform='node-noble' uses BluetoothHost directly — adapterFactory should not be invoked"
          );
        };

      default:
        throw new Error(`Unknown platform: ${platform}`);
    }
  }

  /**
   * Build the host for the resolved platform.
   *
   * `'node-noble'` (Phase 1) gets a `NobleHost` directly — no legacy
   * BLEAdapter shim, since the noble peripheral implements `Peripheral`
   * natively. `@stoprocent/noble` itself is lazily required by the
   * adapter file's dynamic import: `NobleHost` is constructed here but
   * does not pull noble until `scan()`/`isAvailable()`/`dial()`.
   *
   * Every other platform wraps the adapter factory as a
   * `LegacyAdapterHost`.
   */
  protected createHost(platform: Platform, factory: AdapterFactory): BluetoothHost {
    if (platform !== 'node-noble') {
      return new LegacyAdapterHost(factory);
    }

    const bleConfig = {
      serviceUUID: BLE.SERVICE_UUID,
      notifyCharUUID: BLE.NOTIFY_CHAR_UUID,
      writeCharUUID: BLE.WRITE_CHAR_UUID,
      deviceNamePrefix: this.deviceNamePrefix,
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NobleHost } = require('../bluetooth/adapters/node-noble');
    return new NobleHost({ ble: bleConfig });
  }
}
