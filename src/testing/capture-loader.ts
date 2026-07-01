/**
 * Capture-file loader for replay-based testing.
 *
 * Bridges the recorded JSONL session format (device→app BLE traffic
 * captured from a real Voltra) to the `TelemetryFrame[]` that
 * `ReplayBLEAdapter` consumes. Each JSONL line is one event; the loader
 * selects inbound telemetry frames, decodes them with the public
 * `decodeTelemetryFrame` codec, and preserves the recorded timing so
 * replay reproduces the original cadence.
 *
 * The loader is pure and tolerant: malformed lines are skipped (and
 * optionally reported via `onSkip`) rather than aborting the whole load,
 * so a single corrupt line never discards an otherwise-usable session.
 *
 * @example
 * ```typescript
 * import { loadCaptureFrames, ReplayBLEAdapter } from '@voltras/node-sdk/testing';
 *
 * const frames = loadCaptureFrames(jsonlText);
 * const adapter = new ReplayBLEAdapter({ frames });
 * ```
 */

import type { TelemetryFrame } from '../voltra/models/telemetry/frame';
import { decodeTelemetryFrame, identifyMessageType } from '../voltra/protocol/telemetry-decoder';
import { hexToBytes } from '../shared/utils';

/**
 * Why a capture line was skipped.
 *
 * - `'invalid_json'`: the line is not parseable JSON.
 * - `'invalid_hex'`: a `frame_in` entry whose `hex` is missing, odd-length,
 *   or contains non-hex characters.
 * - `'undecodable'`: a telemetry-headed frame that `decodeTelemetryFrame`
 *   rejected (e.g. shorter than a full telemetry frame).
 *
 * Lines that are simply not inbound telemetry (session markers, `frame_out`
 * writes, command responses) are filtered silently — they are not errors.
 */
export type CaptureSkipReason = 'invalid_json' | 'invalid_hex' | 'undecodable';

/**
 * A capture line that could not be turned into a telemetry frame.
 */
export interface CaptureSkip {
  /** 1-based line number within the input text. */
  line: number;
  /** Why the line was skipped. */
  reason: CaptureSkipReason;
  /** The trimmed line content that was skipped. */
  raw: string;
}

/**
 * Options for {@link loadCaptureFrames}.
 */
export interface LoadCaptureFramesOptions {
  /**
   * Invoked once per skipped line. Use it to surface data-quality issues
   * without failing the load. Never called for lines that are legitimately
   * filtered (non-telemetry entries).
   */
  onSkip?: (skip: CaptureSkip) => void;
}

const HEX_PATTERN = /^[0-9a-fA-F]+$/;

/**
 * Parse a JSONL capture session into replayable telemetry frames.
 *
 * Selects inbound (`frame_in`) telemetry-stream frames, decodes each with
 * `decodeTelemetryFrame`, and overrides the decoded `timestamp` with the
 * capture's recorded `ts` (milliseconds since session start) so
 * `ReplayBLEAdapter` reconstructs the original inter-frame timing.
 *
 * @param jsonl Newline-delimited JSON capture text.
 * @param options Optional skip reporting.
 * @returns Telemetry frames in file order.
 */
export function loadCaptureFrames(
  jsonl: string,
  options: LoadCaptureFramesOptions = {}
): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [];

  jsonl.split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '') return;

    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      options.onSkip?.({ line: index + 1, reason: 'invalid_json', raw: line });
      return;
    }

    // Only inbound device→app frames carry telemetry. Session markers,
    // `frame_out` writes, notes, etc. are filtered silently.
    if (!isFrameInEntry(entry)) return;

    const { hex, ts } = entry;
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || !HEX_PATTERN.test(hex)) {
      options.onSkip?.({ line: index + 1, reason: 'invalid_hex', raw: line });
      return;
    }

    const bytes = hexToBytes(hex);

    // A `frame_in` can also be a command response (device name, battery,
    // ...). `decodeTelemetryFrame` does not validate the header, so
    // classify first and keep only telemetry-stream frames.
    if (identifyMessageType(bytes) !== 'telemetry_stream') return;

    const frame = decodeTelemetryFrame(bytes);
    if (frame === null) {
      options.onSkip?.({ line: index + 1, reason: 'undecodable', raw: line });
      return;
    }

    // Replay timing is reconstructed from `frame.timestamp` deltas.
    // `decodeTelemetryFrame` stamps `Date.now()`; override with the
    // recorded `ts` so cadence is preserved.
    frames.push({ ...frame, timestamp: ts });
  });

  return frames;
}

interface FrameInEntry {
  type: 'frame_in';
  ts: number;
  hex: unknown;
}

function isFrameInEntry(entry: unknown): entry is FrameInEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const record = entry as Record<string, unknown>;
  return record.type === 'frame_in' && typeof record.ts === 'number';
}
