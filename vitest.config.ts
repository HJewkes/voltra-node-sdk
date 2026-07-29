import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/__tests__/*'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': './src',
      // `react-native-ble-plx` and `react-native` are OPTIONAL PEER deps and
      // are not installed here, so `bluetooth/adapters/native` — and anything
      // importing it as a value, i.e. `entries/react-native.ts` — cannot load
      // under vitest without these. Inert stubs: they make the module graph
      // resolve so the entry's EXPORT SURFACE can be asserted. They simulate
      // no BLE behaviour and must not be used to claim the native adapter
      // works; that is device-verified.
      'react-native-ble-plx': fileURLToPath(
        new URL('./test/stubs/react-native-ble-plx.ts', import.meta.url)
      ),
      'react-native': fileURLToPath(new URL('./test/stubs/react-native.ts', import.meta.url)),
    },
  },
});
