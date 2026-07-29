/**
 * React Native entry contract.
 *
 * The whole point of this entry is that a Metro bundle never reaches the
 * Node BLE stack. Two independent doors led there, and closing only one is
 * what made VW-101's first attempt fail in a real bundle:
 *   1. `voltra-manager.ts`'s literal `require()` calls (fixed in 0.12.1);
 *   2. `index.ts` value-exporting `createBLEAdapter` from the adapters
 *      barrel, which statically re-exports `NobleHost` from `./node-noble`.
 *
 * These tests pin the export surface. The bundling itself is proven
 * separately by a real `expo export --platform ios` with mobile's Metro
 * resolver stub REMOVED — a module-graph argument is not evidence, which
 * is the lesson that produced this file.
 *
 * Sibling of `web.test.ts`; keep the two in step.
 */
import { describe, it, expect } from 'vitest';
import * as rnEntry from '../react-native';
import { VoltraNativeManager, VOLTRA_DEVICE_PREFIX } from '../react-native';

describe('react-native entry', () => {
  describe('VoltraNativeManager', () => {
    it('resolves the native platform without detection', () => {
      const manager = new VoltraNativeManager();

      expect(manager.resolvedPlatform).toBe('native');
    });

    it('does not name-filter by default', () => {
      const manager = new VoltraNativeManager();

      expect(manager.resolvedDeviceNamePrefix).toBeUndefined();
    });

    it('honors an explicit prefix', () => {
      const manager = new VoltraNativeManager({ deviceNamePrefix: VOLTRA_DEVICE_PREFIX });

      expect(manager.resolvedDeviceNamePrefix).toBe(VOLTRA_DEVICE_PREFIX);
    });

    it('still allows the mock platform', () => {
      // Mock-driven development on a simulator is a real workflow and the
      // mock adapter has no peer dependencies, so it stays reachable.
      const manager = new VoltraNativeManager({ platform: 'mock' });

      expect(manager.resolvedPlatform).toBe('mock');
    });
  });

  describe('forMock', () => {
    it('builds a mock-platform manager', () => {
      const manager = VoltraNativeManager.forMock();

      expect(manager.resolvedPlatform).toBe('mock');
    });

    it('actually connects to a simulated device, with no BLE stack present', async () => {
      // The real assertion. `createAdapterFactory` used to ignore the platform
      // and hand back the platform adapter regardless, so `forMock()` reached
      // for hardware and could not connect in a bare test process. If this
      // regresses, this throws rather than quietly passing.
      const manager = VoltraNativeManager.forMock();
      const client = await manager.connectFirst();

      expect(client).toBeDefined();
      await manager.disconnect();
    });
  });

  describe('export surface', () => {
    it('aliases VoltraManager to VoltraNativeManager', () => {
      // package.json's `react-native` condition resolves the package ROOT
      // here, so `import { VoltraManager }` in app code must keep working.
      expect(rnEntry.VoltraManager).toBe(VoltraNativeManager);
    });

    it('exports the native adapter and client', () => {
      expect(rnEntry.NativeBLEAdapter).toBeDefined();
      expect(rnEntry.VoltraClient).toBeDefined();
    });

    /**
     * The load-bearing assertion. `createBLEAdapter` is on this list for a
     * specific reason: it is not itself a Node adapter, but re-exporting it
     * pulls the `bluetooth/adapters` BARREL, and the barrel value-exports
     * `NobleHost` from `./node-noble` -> `@stoprocent/noble` -> `node:os`.
     * That is the exact chain that broke the iOS bundle after the manager
     * had already been fixed.
     */
    it('exports nothing that reaches the Node adapters', () => {
      const forbidden = [
        'NodeBLEAdapter',
        'NobleHost',
        'NoblePeripheral',
        '__setNobleModuleForTesting',
        'createBLEAdapter',
        'WebBLEAdapter',
      ];

      expect(forbidden.filter((name) => name in rnEntry)).toEqual([]);
    });

    /**
     * Guards the guard: an `in` check against a module namespace that
     * failed to load would make the assertion above vacuously pass.
     */
    it('is actually inspecting a populated module namespace', () => {
      expect('VoltraManager' in rnEntry).toBe(true);
      expect(Object.keys(rnEntry).length).toBeGreaterThan(20);
    });
  });
});
