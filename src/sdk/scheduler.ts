/**
 * Reassert Scheduler — Bug 22
 *
 * Schedules a sequence of "reassert" callbacks at fixed offsets after an
 * arming write (e.g. the EP_SCR_SWITCH commit that drops the device into
 * Rowing-active). Each scheduled tick is tagged with an `attemptId` so a
 * subsequent attempt (or any user mode change) can cancel pending callbacks
 * from prior attempts atomically.
 *
 * Pattern source: Android `scheduleRowLiveModeReassert` ticks at
 * +750 / +1750 / +3000 ms after `startRow()` completes. See
 * voltra-private/research/rowing-protocol-2026-05-06-android-deep.md §7.
 *
 * The scheduler is intentionally protocol-agnostic — callers supply the
 * frames to re-send. This keeps protocol-derived knowledge out of the
 * scheduler primitive.
 */

/** Default reassert offsets in milliseconds, matching the Android cadence. */
export const DEFAULT_REASSERT_DELAYS_MS: readonly number[] = [750, 1750, 3000];

export interface ReassertSchedulerOptions {
  /** Delay offsets in milliseconds, relative to `arm()`. Defaults to [750, 1750, 3000]. */
  delaysMs?: readonly number[];
}

/**
 * Schedules cancelable reassert ticks. One scheduler instance manages a
 * single "current attempt" — `arm()` cancels any previously-pending ticks,
 * bumps the attempt counter, and re-schedules a fresh series.
 */
export class ReassertScheduler {
  private readonly delaysMs: readonly number[];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private attemptId = 0;

  constructor(options: ReassertSchedulerOptions = {}) {
    this.delaysMs = options.delaysMs ?? DEFAULT_REASSERT_DELAYS_MS;
  }

  /**
   * Schedule a fresh series of reassert ticks. Cancels any pending ticks
   * from prior calls. The tick callback receives the `attemptId` for this
   * series and the zero-based tick index so the caller can short-circuit
   * if the active attempt has changed under it (e.g. due to a re-arm).
   *
   * @returns The `attemptId` for the scheduled series.
   */
  arm(tick: (attemptId: number, tickIndex: number) => void | Promise<void>): number {
    this.cancel();
    const myAttempt = ++this.attemptId;
    this.timers = this.delaysMs.map((delay, index) =>
      setTimeout(() => {
        // Re-check: a later cancel() / arm() may have raced this fire.
        if (myAttempt !== this.attemptId) return;
        void tick(myAttempt, index);
      }, delay),
    );
    return myAttempt;
  }

  /** Cancel all pending ticks. Subsequent `arm()` calls reset the schedule. */
  cancel(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Returns the most recently armed attempt id (0 before any `arm()`). */
  get currentAttemptId(): number {
    return this.attemptId;
  }
}
