/**
 * Unit tests for the ReassertScheduler primitive (Bug 22).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReassertScheduler, DEFAULT_REASSERT_DELAYS_MS } from '../scheduler';

describe('ReassertScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('default delays match the Android +750/+1750/+3000 ms cadence', () => {
    expect([...DEFAULT_REASSERT_DELAYS_MS]).toEqual([750, 1750, 3000]);
  });

  it('fires each tick at the configured offset', () => {
    const scheduler = new ReassertScheduler({ delaysMs: [100, 250, 500] });
    const ticks: Array<[number, number, number]> = [];

    const armedAt = scheduler.arm((attemptId, index) => {
      ticks.push([attemptId, index, Date.now()]);
    });

    expect(armedAt).toBe(1);
    vi.advanceTimersByTime(99);
    expect(ticks).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(ticks).toEqual([[1, 0, expect.any(Number)]]);

    vi.advanceTimersByTime(150); // total elapsed 250
    expect(ticks).toHaveLength(2);
    expect(ticks[1][1]).toBe(1);

    vi.advanceTimersByTime(250); // total elapsed 500
    expect(ticks).toHaveLength(3);
    expect(ticks[2][1]).toBe(2);
  });

  it('cancel() prevents pending ticks from firing', () => {
    const scheduler = new ReassertScheduler({ delaysMs: [100, 200, 300] });
    const ticks: number[] = [];

    scheduler.arm((_attemptId, index) => {
      ticks.push(index);
    });

    vi.advanceTimersByTime(150);
    expect(ticks).toEqual([0]);

    scheduler.cancel();
    vi.advanceTimersByTime(500);
    expect(ticks).toEqual([0]);
  });

  it('arm() cancels prior pending ticks and bumps the attempt id', () => {
    const scheduler = new ReassertScheduler({ delaysMs: [100, 200] });
    const ticks: Array<{ attempt: number; index: number }> = [];

    scheduler.arm((attemptId, index) => {
      ticks.push({ attempt: attemptId, index });
    });

    vi.advanceTimersByTime(50);
    // Re-arm before any tick fires.
    const secondAttempt = scheduler.arm((attemptId, index) => {
      ticks.push({ attempt: attemptId, index });
    });
    expect(secondAttempt).toBe(2);

    vi.advanceTimersByTime(300);

    // Only the second attempt's ticks should have fired.
    expect(ticks.every((t) => t.attempt === 2)).toBe(true);
    expect(ticks.map((t) => t.index)).toEqual([0, 1]);
  });

  it('attemptId is exposed via currentAttemptId', () => {
    const scheduler = new ReassertScheduler();
    expect(scheduler.currentAttemptId).toBe(0);
    scheduler.arm(() => {});
    expect(scheduler.currentAttemptId).toBe(1);
    scheduler.arm(() => {});
    expect(scheduler.currentAttemptId).toBe(2);
    scheduler.cancel();
    // cancel does not reset the counter — only arm() bumps it.
    expect(scheduler.currentAttemptId).toBe(2);
  });

  it('scheduled callback is no-op if attemptId was superseded between fire-time and dispatch', () => {
    // Edge case: the attempt id check inside the scheduled callback guards
    // against stale ticks even if cancellation races the timer firing.
    const scheduler = new ReassertScheduler({ delaysMs: [100] });
    const ticks: number[] = [];

    scheduler.arm((attemptId) => {
      ticks.push(attemptId);
    });
    // Re-arm just before the original tick would fire.
    vi.advanceTimersByTime(99);
    scheduler.arm((attemptId) => {
      ticks.push(attemptId);
    });
    // Fire — original tick should be cancelled (timer cleared), new one
    // hasn't yet reached its 100 ms offset.
    vi.advanceTimersByTime(1);
    expect(ticks).toEqual([]);

    // New tick fires after another 100 ms.
    vi.advanceTimersByTime(100);
    expect(ticks).toEqual([2]);
  });
});
