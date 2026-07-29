/**
 * Vitest stub for the `react-native-ble-plx` PEER dependency.
 *
 * The package is an optional peer dep and is not installed in this repo, so
 * anything importing `bluetooth/adapters/native` cannot load under vitest at
 * all. That is why the root `index.ts` exports `NativeBLEAdapter` as a TYPE
 * only — and why the native path had no test coverage before this stub.
 *
 * `entries/react-native.ts` imports the adapter as a VALUE (a Metro bundle
 * both can and must resolve it), so its contract test needs this alias to
 * load the module namespace at all. Nothing here simulates BLE behaviour:
 * it exists so the module graph resolves, and the assertions it enables are
 * about the EXPORT SURFACE, not about talking to a device.
 *
 * Aliased in `vitest.config.ts`. Lives outside `src/` so it is never built
 * or published.
 */

export class BleManager {
  onStateChange(): { remove: () => void } {
    return { remove: () => {} };
  }
  state(): Promise<string> {
    return Promise.resolve('PoweredOn');
  }
  startDeviceScan(): void {}
  stopDeviceScan(): void {}
  destroy(): void {}
}

export const State = {
  PoweredOn: 'PoweredOn',
  PoweredOff: 'PoweredOff',
  Unknown: 'Unknown',
  Unsupported: 'Unsupported',
  Unauthorized: 'Unauthorized',
  Resetting: 'Resetting',
} as const;

export type Device = unknown;
