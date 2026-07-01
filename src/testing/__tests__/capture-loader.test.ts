/**
 * Tests for the JSONL capture loader.
 *
 * Sample hex is generated from the public `encodeTelemetryFrame` codec —
 * no protocol byte tables are hardcoded here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadCaptureFrames, type CaptureSkip } from '../capture-loader';
import { ReplayBLEAdapter } from '../../bluetooth/adapters/replay';
import { createFrame } from '../../voltra/models/telemetry/frame';
import { encodeTelemetryFrame } from '../../voltra/protocol/telemetry-decoder';
import { bytesToHex } from '../../shared/utils';
import { MovementPhase } from '../../voltra/protocol/constants';

/** Encode a telemetry frame to the lowercase hex a capture line carries. */
function telemetryHex(
  sequence: number,
  phase: MovementPhase,
  position: number,
  force: number,
  velocity: number
): string {
  return bytesToHex(encodeTelemetryFrame(createFrame(sequence, phase, position, force, velocity)));
}

function frameInLine(ts: number, hex: string): string {
  return JSON.stringify({ type: 'frame_in', ts, hex, tier: 'stream' });
}

describe('loadCaptureFrames', () => {
  it('decodes inbound telemetry frames with recorded timestamps', () => {
    const jsonl = [
      JSON.stringify({ type: 'session_start', ts: 0, deviceName: null }),
      frameInLine(2361, telemetryHex(10, MovementPhase.CONCENTRIC, 120, 450, 80)),
      frameInLine(2452, telemetryHex(11, MovementPhase.CONCENTRIC, 240, 470, 60)),
    ].join('\n');

    const frames = loadCaptureFrames(jsonl);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      sequence: 10,
      phase: MovementPhase.CONCENTRIC,
      position: 120,
      force: 450,
      velocity: 80,
      timestamp: 2361,
    });
    expect(frames[1]).toMatchObject({ sequence: 11, timestamp: 2452 });
  });

  it('filters out session markers, frame_out writes, and non-telemetry frame_in', () => {
    const jsonl = [
      JSON.stringify({ type: 'session_start', ts: 0, deviceName: null }),
      JSON.stringify({ type: 'connect', ts: 100, deviceName: 'VTR-000000' }),
      JSON.stringify({ type: 'frame_out', ts: 200, hex: 'deadbeef' }),
      JSON.stringify({ type: 'note', ts: 250, text: 'set mode' }),
      // A frame_in that is NOT a telemetry-stream frame (arbitrary header).
      frameInLine(300, '00112233445566778899aabbccddeeff00112233445566778899'),
      frameInLine(400, telemetryHex(1, MovementPhase.IDLE, 0, 0, 0)),
      JSON.stringify({ type: 'session_end', ts: 500 }),
    ].join('\n');

    const skips: CaptureSkip[] = [];
    const frames = loadCaptureFrames(jsonl, { onSkip: (s) => skips.push(s) });

    // Only the single real telemetry frame survives; nothing is reported as
    // a skip because none of the filtered lines are malformed.
    expect(frames).toHaveLength(1);
    expect(frames[0].sequence).toBe(1);
    expect(skips).toHaveLength(0);
  });

  it('skips a malformed (non-JSON) line and reports it without throwing', () => {
    const jsonl = [
      frameInLine(100, telemetryHex(5, MovementPhase.CONCENTRIC, 50, 100, 30)),
      'this is not valid json {',
      frameInLine(200, telemetryHex(6, MovementPhase.CONCENTRIC, 60, 110, 25)),
    ].join('\n');

    const skips: CaptureSkip[] = [];
    const frames = loadCaptureFrames(jsonl, { onSkip: (s) => skips.push(s) });

    expect(frames).toHaveLength(2);
    expect(skips).toHaveLength(1);
    expect(skips[0]).toMatchObject({ line: 2, reason: 'invalid_json' });
  });

  it('reports a frame_in with invalid hex', () => {
    const jsonl = [
      JSON.stringify({ type: 'frame_in', ts: 100, hex: 'nothex!!' }),
      JSON.stringify({ type: 'frame_in', ts: 200, hex: 'abc' }), // odd length
    ].join('\n');

    const skips: CaptureSkip[] = [];
    const frames = loadCaptureFrames(jsonl, { onSkip: (s) => skips.push(s) });

    expect(frames).toHaveLength(0);
    expect(skips.map((s) => s.reason)).toEqual(['invalid_hex', 'invalid_hex']);
  });

  it('ignores blank lines and trailing whitespace', () => {
    const jsonl = [
      '',
      '  ',
      frameInLine(100, telemetryHex(1, MovementPhase.IDLE, 0, 0, 0)),
      '',
    ].join('\n');

    const skips: CaptureSkip[] = [];
    const frames = loadCaptureFrames(jsonl, { onSkip: (s) => skips.push(s) });

    expect(frames).toHaveLength(1);
    expect(skips).toHaveLength(0);
  });

  describe('output feeds ReplayBLEAdapter', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('replays loaded frames as notifications in order', async () => {
      const jsonl = [
        frameInLine(0, telemetryHex(1, MovementPhase.CONCENTRIC, 10, 100, 40)),
        frameInLine(91, telemetryHex(2, MovementPhase.CONCENTRIC, 20, 110, 35)),
        frameInLine(182, telemetryHex(3, MovementPhase.HOLD, 30, 120, 0)),
      ].join('\n');

      const frames = loadCaptureFrames(jsonl);
      const adapter = new ReplayBLEAdapter({ frames });

      const received: Uint8Array[] = [];
      adapter.onNotification((data) => received.push(data));

      await adapter.connect('replay-device');
      // Advance past the full recorded span so every frame emits.
      await vi.advanceTimersByTimeAsync(500);

      expect(received).toHaveLength(3);
      expect(adapter.totalFrames()).toBe(3);

      await adapter.disconnect();
    });
  });
});
