/**
 * ReplayBLEAdapter
 *
 * Plays back a recorded `TelemetryFrame[]` array through the standard
 * `BLEAdapter` notification interface, with timing reconstructed from
 * each frame's `timestamp` field.
 *
 * Lets capture-file regression tests (e.g.
 * `voltra-private/captures/sessions/.../*.jsonl`) drive the real SDK
 * code path — `VoltraClient`, `VoltraManager`, the bridge — without
 * physical hardware.
 *
 * Frames are emitted as 30-byte encoded BLE notifications via
 * `encodeTelemetryFrame()` so the consumer side cannot tell the
 * difference from a real device's `notify` callback.
 *
 * This adapter does NOT speak the writer side: `write()` is a no-op
 * that buffers bytes for test inspection. Replay is a one-way stream.
 */

import { BaseBLEAdapter } from './base';
import type { Device, ConnectOptions } from './types';
import type { TelemetryFrame } from '../../voltra/models/telemetry/frame';
import { encodeTelemetryFrame } from '../../voltra/protocol/telemetry-decoder';

const DEFAULT_DEVICE_ID = 'replay-device';
const DEFAULT_DEVICE_NAME = 'VTR-REPLAY';
const DEFAULT_PLAYBACK_SPEED = 1.0;

export interface ReplayBLEAdapterOptions {
  /** Recorded frames to replay, in chronological order (by `timestamp`). */
  frames: TelemetryFrame[];
  /**
   * Playback speed multiplier. `1.0` = real-time (matches the original
   * inter-frame deltas), `2.0` = twice as fast, `0.5` = half-speed.
   * Defaults to `1.0`. Must be `> 0`.
   */
  playbackSpeed?: number;
  /**
   * If `true` (default), `connect()` immediately starts emitting
   * notifications. If `false`, the caller must call `play()` after
   * connecting.
   */
  autoStart?: boolean;
  /** Stable device id returned from `scan()`. Defaults to `'replay-device'`. */
  deviceId?: string;
  /** Device name returned from `scan()`. Defaults to `'VTR-REPLAY'`. */
  deviceName?: string;
}

/**
 * Replay adapter — emits a recorded `TelemetryFrame[]` as encoded BLE
 * notifications with reconstructed timing. Implements the same
 * `BLEAdapter` surface as `MockBLEAdapter`; transparent to consumers.
 */
export class ReplayBLEAdapter extends BaseBLEAdapter {
  private readonly frames: TelemetryFrame[];
  private playbackSpeed: number;
  private readonly autoStart: boolean;
  private readonly deviceId: string;
  private readonly deviceName: string;

  /** Index of the next frame to emit (0-based). */
  private nextFrameIndex = 0;
  /** True after the first frame has been emitted (for `currentFrameIndex`). */
  private hasEmittedAny = false;
  /** Pending setTimeout handle, or null when paused / stopped / drained. */
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** True between `play()` (or autoStart `connect()`) and `pause()` / drain / `disconnect()`. */
  private playing = false;
  /** True between `connect()` and `disconnect()`. */
  private linkAlive = false;
  /** Bytes buffered by `write()` calls — exposed via `getWrites()` for tests. */
  private readonly writeBuffer: Uint8Array[] = [];

  constructor(options: ReplayBLEAdapterOptions) {
    super();
    if (options.playbackSpeed !== undefined && options.playbackSpeed <= 0) {
      throw new Error(`ReplayBLEAdapter: playbackSpeed must be > 0 (got ${options.playbackSpeed})`);
    }
    this.frames = options.frames;
    this.playbackSpeed = options.playbackSpeed ?? DEFAULT_PLAYBACK_SPEED;
    this.autoStart = options.autoStart ?? true;
    this.deviceId = options.deviceId ?? DEFAULT_DEVICE_ID;
    this.deviceName = options.deviceName ?? DEFAULT_DEVICE_NAME;
  }

  // ===========================================================================
  // BLEAdapter surface
  // ===========================================================================

  async scan(_timeout: number): Promise<Device[]> {
    return [{ id: this.deviceId, name: this.deviceName, rssi: -50 }];
  }

  async connect(_deviceId: string, _options?: ConnectOptions): Promise<void> {
    this.setConnectionState('connecting');
    this.linkAlive = true;
    this.setConnectionState('connected');
    if (this.autoStart) {
      this.play();
    }
  }

  async disconnect(): Promise<void> {
    this.clearPendingTimer();
    this.playing = false;
    this.linkAlive = false;
    this.setConnectionState('disconnected');
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.linkAlive) {
      throw new Error('Not connected to replay adapter');
    }
    // Replay is a one-way stream — capture writes for test inspection.
    this.writeBuffer.push(data);
  }

  override isLinkAlive(): boolean {
    return this.linkAlive;
  }

  // ===========================================================================
  // Replay-specific controls
  // ===========================================================================

  /**
   * Start (or resume) playback from the current frame index. No-op if
   * already playing or if the recording has been fully drained.
   */
  play(): void {
    if (this.playing) return;
    if (this.nextFrameIndex >= this.frames.length) return;
    this.playing = true;
    this.scheduleNext();
  }

  /**
   * Freeze playback. Subsequent `play()` resumes from the same frame
   * index. No-op if already paused.
   */
  pause(): void {
    if (!this.playing) return;
    this.clearPendingTimer();
    this.playing = false;
  }

  /**
   * Jump the playhead. Clamped to `[0, frames.length]`. The next frame
   * emitted will be `frames[clampedIndex]`. If playback was active, the
   * pending timer is rescheduled relative to the new position; if
   * paused, the new index takes effect on the next `play()`.
   */
  seek(frameIndex: number): void {
    const clamped = Math.max(0, Math.min(frameIndex, this.frames.length));
    this.nextFrameIndex = clamped;
    if (this.playing) {
      this.clearPendingTimer();
      if (clamped >= this.frames.length) {
        this.playing = false;
        return;
      }
      this.scheduleNext();
    }
  }

  /**
   * Update playback speed. Takes effect on the NEXT scheduled emit —
   * the in-flight `setTimeout` is not retroactively warped.
   */
  setSpeed(factor: number): void {
    if (factor <= 0) {
      throw new Error(`ReplayBLEAdapter: playbackSpeed must be > 0 (got ${factor})`);
    }
    this.playbackSpeed = factor;
  }

  /** True between `play()` and `pause()` / drain / `disconnect()`. */
  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Index of the most recently emitted frame, or `-1` if no frames have
   * been emitted yet (i.e., before the first emit, or after a `seek(0)`
   * with no subsequent emits).
   */
  currentFrameIndex(): number {
    return this.hasEmittedAny ? this.nextFrameIndex - 1 : -1;
  }

  /** Total number of frames in the recording. */
  totalFrames(): number {
    return this.frames.length;
  }

  /**
   * Snapshot of the bytes the consumer has written to this adapter.
   * Useful for tests asserting the SDK's outbound BLE traffic during a
   * replay run.
   */
  getWrites(): Uint8Array[] {
    return this.writeBuffer.slice();
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private scheduleNext(): void {
    const idx = this.nextFrameIndex;
    if (idx >= this.frames.length) {
      this.playing = false;
      return;
    }

    // First frame: emit immediately so consumers see something on connect.
    // Subsequent frames: use the recorded delta divided by playback speed.
    const delayMs =
      idx === 0
        ? 0
        : Math.max(
            0,
            (this.frames[idx].timestamp - this.frames[idx - 1].timestamp) / this.playbackSpeed
          );

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      // Guards: a `disconnect()` or `pause()` could have fired before the
      // timer resolved (real timers, not just fake-timer races).
      if (!this.playing || !this.linkAlive) return;

      const frame = this.frames[idx];
      this.emitNotification(encodeTelemetryFrame(frame));
      this.nextFrameIndex = idx + 1;
      this.hasEmittedAny = true;

      if (this.nextFrameIndex >= this.frames.length) {
        this.playing = false;
        return;
      }
      this.scheduleNext();
    }, delayMs);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }
}
