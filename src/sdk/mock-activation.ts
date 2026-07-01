/**
 * SDK-level mock activation.
 *
 * Lets consumers force the mock BLE adapter outside a browser — on native
 * (React Native) and Node builds — where the web-only `?mock` URL param is
 * unavailable. Two sources, checked by `isMockActivated()`:
 *
 *  1. A programmatic flag set via `setMockActivation(true)`. This is the
 *     hook a mobile app uses after reading its own persisted flag (e.g. an
 *     AsyncStorage value driven by a dev-menu toggle) — the SDK stays
 *     storage-agnostic and only exposes the switch.
 *  2. The `VOLTRA_MOCK` environment variable (`1`/`true`/`yes`/`on`). Works
 *     in Node and in React Native where Metro inlines `process.env` at
 *     build time.
 *
 * When active, `VoltraManager`'s platform auto-detection resolves to
 * `'mock'`. An explicit `platform`, `adapterFactory`, or `host` option
 * still takes precedence — activation only influences auto-detection.
 */

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

let programmaticActivation: boolean | undefined;

function envMockActivated(): boolean {
  if (typeof process === 'undefined' || process.env == null) {
    return false;
  }
  const raw = process.env.VOLTRA_MOCK;
  return typeof raw === 'string' && TRUTHY_ENV_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Programmatically force (or clear) mock activation.
 *
 * @param enabled `true`/`false` to force the state, or `undefined` to defer
 *   back to the `VOLTRA_MOCK` environment variable.
 */
export function setMockActivation(enabled: boolean | undefined): void {
  programmaticActivation = enabled;
}

/**
 * True when the mock adapter should be selected during platform
 * auto-detection. The programmatic flag overrides the environment variable
 * whenever it has been set.
 */
export function isMockActivated(): boolean {
  if (programmaticActivation !== undefined) {
    return programmaticActivation;
  }
  return envMockActivated();
}
