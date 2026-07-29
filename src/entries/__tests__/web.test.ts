/**
 * Browser entry contract.
 *
 * The whole point of this entry is that a browser bundle never reaches the
 * platform-switching `VoltraManager`, whose literal `require()` calls force
 * a `node:module` shim that no bundler can resolve. These tests pin the
 * behavior that guarantees it; the bundling itself is proven separately by
 * a real `vite build` (see CHANGELOG).
 */
import { describe, it, expect } from 'vitest';
import * as webEntry from '../web';
import { VoltraWebManager, VOLTRA_DEVICE_PREFIX } from '../web';

describe('web entry', () => {
  describe('VoltraWebManager', () => {
    it('resolves the web platform without detection', () => {
      const manager = new VoltraWebManager();

      expect(manager.resolvedPlatform).toBe('web');
    });

    it('does not name-filter by default', () => {
      const manager = new VoltraWebManager();

      expect(manager.resolvedDeviceNamePrefix).toBeUndefined();
    });

    it('honors an explicit prefix', () => {
      const manager = new VoltraWebManager({ deviceNamePrefix: VOLTRA_DEVICE_PREFIX });

      expect(manager.resolvedDeviceNamePrefix).toBe(VOLTRA_DEVICE_PREFIX);
    });

    it('treats an explicit null as disabled', () => {
      const manager = new VoltraWebManager({ deviceNamePrefix: null });

      expect(manager.resolvedDeviceNamePrefix).toBeUndefined();
    });
  });

  describe('forMock', () => {
    it('builds a mock-platform manager', () => {
      const manager = VoltraWebManager.forMock();

      expect(manager.resolvedPlatform).toBe('mock');
    });

    it('actually connects to a simulated device, with no BLE stack present', async () => {
      // The real assertion. `createAdapterFactory` used to ignore the platform
      // and hand back the platform adapter regardless, so `forMock()` reached
      // for hardware and could not connect in a bare test process. If this
      // regresses, this throws rather than quietly passing.
      const manager = VoltraWebManager.forMock();
      const client = await manager.connectFirst();

      expect(client).toBeDefined();
      await manager.disconnect();
    });
  });

  describe('export surface', () => {
    it('aliases VoltraManager to VoltraWebManager', () => {
      // package.json's `browser` condition resolves the package ROOT here,
      // so `import { VoltraManager }` in browser code must keep working.
      expect(webEntry.VoltraManager).toBe(VoltraWebManager);
    });

    it('exports the browser adapter and client', () => {
      expect(webEntry.WebBLEAdapter).toBeDefined();
      expect(webEntry.VoltraClient).toBeDefined();
    });

    /**
     * The load-bearing assertion: re-exporting any of these would pull
     * voltra-manager.ts / node.ts / node-noble.ts / native.ts back into the
     * browser module graph and reintroduce the `createRequire` shim and the
     * Node BLE dependency chain.
     */
    it('exports nothing that reaches the Node or native adapters', () => {
      const forbidden = [
        'NodeBLEAdapter',
        'NativeBLEAdapter',
        'NobleHost',
        'NoblePeripheral',
        'createBLEAdapter',
      ];

      expect(forbidden.filter((name) => name in webEntry)).toEqual([]);
    });

    it('does not expose Node-only manager factories', () => {
      // VoltraWebManager deliberately carries no forNode/forNative/forNodeNoble.
      const managerStatics = Object.getOwnPropertyNames(VoltraWebManager);

      expect(managerStatics).not.toContain('forNode');
      expect(managerStatics).not.toContain('forNative');
      expect(managerStatics).not.toContain('forNodeNoble');
    });
  });
});
