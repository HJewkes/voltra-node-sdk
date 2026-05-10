/**
 * `@voltras/node-sdk/testing` — adapters and helpers for tests, demos,
 * and capture-file replay.
 *
 * This subpath is the canonical home for non-hardware adapters:
 *
 * - `MockBLEAdapter` — synthesizes a live device with realistic phase
 *   transitions and rep/set boundaries. Use for visual development and
 *   for tests that need an active session.
 *
 * - `ReplayBLEAdapter` — plays back a recorded `TelemetryFrame[]`
 *   array (e.g. from `voltra-private/captures/sessions/.../*.jsonl`)
 *   with reconstructed timing. Use for regression tests against real
 *   device captures without hardware.
 *
 * Both are also re-exported from the package root for backwards
 * compatibility; new code should prefer this subpath.
 */

export {
  MockBLEAdapter,
  type MockBLEConfig,
  type MockSessionConfig,
  type PlannedRepProfile,
  createMultiSetScenario,
  createPauseSetScenario,
  createTempoScenario,
  createShortRestScenario,
} from '../bluetooth/adapters/mock';

export { ReplayBLEAdapter, type ReplayBLEAdapterOptions } from '../bluetooth/adapters/replay';
