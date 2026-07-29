/**
 * Vitest stub for the `react-native` PEER dependency — see the sibling
 * `react-native-ble-plx.ts` stub for why these exist. `native.ts` reaches
 * `AppState`/`Platform`/`PermissionsAndroid` for its auto-reconnect and
 * Android permission paths; none of that is exercised by an export-surface
 * test, so these are inert.
 */

export const AppState = {
  currentState: 'active' as const,
  addEventListener: (): { remove: () => void } => ({ remove: () => {} }),
};

export const Platform = { OS: 'ios' as const };

export const PermissionsAndroid = {
  PERMISSIONS: {},
  RESULTS: { GRANTED: 'granted' },
  requestMultiple: (): Promise<Record<string, string>> => Promise.resolve({}),
};

export type AppStateStatus = 'active' | 'background' | 'inactive';
