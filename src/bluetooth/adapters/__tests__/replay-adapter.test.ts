/**
 * ReplayBLEAdapter Tests
 *
 * Verifies timing reconstruction, playback controls (play/pause/seek/
 * setSpeed), connection lifecycle, and write buffering. All timing is
 * driven via `vi.useFakeTimers()` for determinism.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplayBLEAdapter } from '../replay';
import { createFrame } from '../../../voltra/models/telemetry/frame';
import {
  decodeTelemetryFrame,
  encodeTelemetryFrame,
} from '../../../voltra/protocol/telemetry-decoder';
import { MovementPhase } from '../../../voltra/protocol/constants/enums';
import type { TelemetryFrame } from '../../../voltra/models/telemetry/frame';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build a synthetic recording with frames spaced `intervalMs` apart.
 * Sequences increment from `0`, phases cycle CONCENTRIC -> HOLD ->
 * ECCENTRIC -> IDLE so each frame is distinguishable on decode.
 */
function buildFrames(count: number, intervalMs = 91, startTs = 1_000_000): TelemetryFrame[] {
  const phases = [
    MovementPhase.CONCENTRIC,
    MovementPhase.HOLD,
    MovementPhase.ECCENTRIC,
    MovementPhase.IDLE,
  ];
  const frames: TelemetryFrame[] = [];
  for (let i = 0; i < count; i++) {
    const f = createFrame(i, phases[i % phases.length], 100 + i, 50 + i, 200 + i);
    frames.push({ ...f, timestamp: startTs + i * intervalMs });
  }
  return frames;
}

function collect(adapter: ReplayBLEAdapter): Uint8Array[] {
  const out: Uint8Array[] = [];
  adapter.onNotification((b) => out.push(b));
  return out;
}

// =============================================================================
// Tests
// =============================================================================

describe('ReplayBLEAdapter', () => {
  it('connect() with autoStart fires the first frame immediately', async () => {
    const frames = buildFrames(3, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');

    // First frame is scheduled with delay=0; flush the timer.
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toHaveLength(1);
    expect(decodeTelemetryFrame(got[0])!.sequence).toBe(0);
  });

  it('emits notifications at reconstructed inter-frame intervals', async () => {
    const frames = buildFrames(4, 100); // 100ms between frames
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(got).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(99);
    expect(got).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toHaveLength(3);
  });

  it('playbackSpeed: 2.0 halves inter-frame delays', async () => {
    const frames = buildFrames(3, 100);
    const adapter = new ReplayBLEAdapter({ frames, playbackSpeed: 2.0 });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(50);
    expect(got).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(got).toHaveLength(3);
  });

  it('pause() halts emission until play() resumes', async () => {
    const frames = buildFrames(5, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toHaveLength(1);

    adapter.pause();
    expect(adapter.isPlaying()).toBe(false);

    // Advance well past the next interval — nothing should fire.
    await vi.advanceTimersByTimeAsync(1000);
    expect(got).toHaveLength(1);

    adapter.play();
    expect(adapter.isPlaying()).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(got).toHaveLength(2);
  });

  it('seek(N) makes the next emission be frames[N]', async () => {
    const frames = buildFrames(8, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);
    expect(decodeTelemetryFrame(got[0])!.sequence).toBe(0);

    adapter.seek(5);
    await vi.advanceTimersByTimeAsync(100);
    expect(got).toHaveLength(2);
    expect(decodeTelemetryFrame(got[1])!.sequence).toBe(5);
  });

  it('seek() clamped to frame count stops playback at end', async () => {
    const frames = buildFrames(3, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);

    adapter.seek(99);
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.isPlaying()).toBe(false);
    // Only the original frame[0] emit; seek-to-end fires nothing further.
    expect(got).toHaveLength(1);
  });

  it('seek() with a fractional index floors it and does not crash while playing', async () => {
    const frames = buildFrames(8, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);

    // 1.5 must floor to 1 rather than indexing frames[1.5] (undefined) and
    // throwing inside scheduleNext().
    expect(() => adapter.seek(1.5)).not.toThrow();
    await vi.advanceTimersByTimeAsync(100);

    expect(got).toHaveLength(2);
    expect(decodeTelemetryFrame(got[1])!.sequence).toBe(1);
  });

  it('seek(NaN) is treated as 0 and does not crash while playing', async () => {
    const frames = buildFrames(8, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);

    expect(() => adapter.seek(Number.NaN)).not.toThrow();
    // Seeking to 0 reschedules frame[0] with delay 0; flush just that emit.
    await vi.advanceTimersByTimeAsync(0);

    expect(got).toHaveLength(2);
    expect(decodeTelemetryFrame(got[1])!.sequence).toBe(0);
  });

  it('setSpeed() takes effect on the NEXT emit, not the in-flight one', async () => {
    const frames = buildFrames(4, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toHaveLength(1);

    // Halve speed mid-flight; the already-scheduled 100ms timer for frame[1]
    // is NOT warped — it still fires at t=100.
    adapter.setSpeed(0.5);
    await vi.advanceTimersByTimeAsync(100);
    expect(got).toHaveLength(2);

    // Frame[2] is now scheduled at original_delta / 0.5 = 200ms.
    await vi.advanceTimersByTimeAsync(199);
    expect(got).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toHaveLength(3);
  });

  it('empty frames[]: connect() succeeds, no notifications fire', async () => {
    const adapter = new ReplayBLEAdapter({ frames: [] });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(got).toHaveLength(0);
    expect(adapter.isPlaying()).toBe(false);
    expect(adapter.currentFrameIndex()).toBe(-1);
    expect(adapter.isLinkAlive()).toBe(true);
  });

  it('disconnect() clears pending timer; no further notifications', async () => {
    const frames = buildFrames(5, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toHaveLength(1);

    await adapter.disconnect();
    expect(adapter.isLinkAlive()).toBe(false);
    expect(adapter.isPlaying()).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(got).toHaveLength(1);
  });

  it('currentFrameIndex() advances with each emit', async () => {
    const frames = buildFrames(4, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    collect(adapter);

    expect(adapter.currentFrameIndex()).toBe(-1);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.currentFrameIndex()).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.currentFrameIndex()).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.currentFrameIndex()).toBe(2);
  });

  it('autoStart: false defers emission until play() is called', async () => {
    const frames = buildFrames(3, 100);
    const adapter = new ReplayBLEAdapter({ frames, autoStart: false });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(1000);
    expect(got).toHaveLength(0);
    expect(adapter.isPlaying()).toBe(false);

    adapter.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toHaveLength(1);
  });

  it('write() buffers bytes and is queryable via getWrites()', async () => {
    const adapter = new ReplayBLEAdapter({ frames: buildFrames(1) });
    await adapter.connect('replay-device');

    const a = new Uint8Array([0x55, 0x12, 0x04, 0xc7]);
    const b = new Uint8Array([0xaa, 0x80, 0x25]);
    await adapter.write(a);
    await adapter.write(b);

    const writes = adapter.getWrites();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(a);
    expect(writes[1]).toEqual(b);
  });

  it('write() throws when not connected', async () => {
    const adapter = new ReplayBLEAdapter({ frames: buildFrames(1) });
    await expect(adapter.write(new Uint8Array([0x00]))).rejects.toThrow(/Not connected/);
  });

  it('emitted bytes are byte-equal to encodeTelemetryFrame(originalFrame)', async () => {
    const frames = buildFrames(2, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(got[0]).toEqual(encodeTelemetryFrame(frames[0]));
    expect(got[1]).toEqual(encodeTelemetryFrame(frames[1]));
  });

  it('drains naturally: isPlaying() flips false after last emit', async () => {
    const frames = buildFrames(3, 100);
    const adapter = new ReplayBLEAdapter({ frames });
    const got = collect(adapter);

    await adapter.connect('replay-device');
    await vi.advanceTimersByTimeAsync(0); // frame 0
    await vi.advanceTimersByTimeAsync(100); // frame 1
    await vi.advanceTimersByTimeAsync(100); // frame 2
    expect(got).toHaveLength(3);
    expect(adapter.isPlaying()).toBe(false);

    // Subsequent play() on a drained recording is a no-op.
    adapter.play();
    expect(adapter.isPlaying()).toBe(false);
  });

  it('constructor throws on non-positive playbackSpeed', () => {
    const frames = buildFrames(1);
    expect(() => new ReplayBLEAdapter({ frames, playbackSpeed: 0 })).toThrow(/> 0/);
    expect(() => new ReplayBLEAdapter({ frames, playbackSpeed: -1 })).toThrow(/> 0/);
  });

  it('setSpeed() throws on non-positive factor', () => {
    const adapter = new ReplayBLEAdapter({ frames: buildFrames(1) });
    expect(() => adapter.setSpeed(0)).toThrow(/> 0/);
    expect(() => adapter.setSpeed(-2)).toThrow(/> 0/);
  });

  it('scan() returns the configured device id and name', async () => {
    const adapter = new ReplayBLEAdapter({
      frames: buildFrames(1),
      deviceId: 'VTR-CUSTOM',
      deviceName: 'Capture Replay',
    });
    const devices = await adapter.scan(1000);
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe('VTR-CUSTOM');
    expect(devices[0].name).toBe('Capture Replay');
  });
});
