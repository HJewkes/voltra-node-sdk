/**
 * Frame Reassembler
 *
 * A BLE notification is a transport chunk, not a promise of one whole frame.
 * CoreBluetooth on macOS has never split one, but other transports may, so
 * this sits between the notification and the decoder and hands on only whole,
 * checksum-intact frames.
 *
 * One instance per device. Sharing one would let a device's unfinished frame
 * be completed by another device's bytes.
 */

import { FRAME_MARKER, scanEnvelope } from '../voltra/protocol/frame-envelope';

/** Bytes dropped, and frames whose checksums did not hold. */
export interface FrameReassemblerCounters {
  readonly discardedBytes: number;
  readonly rejectedFrames: number;
}

/** Called once per whole frame, in arrival order. */
export type FrameSink = (frame: Uint8Array) => void;

export class FrameReassembler {
  private pending: Uint8Array | null = null;
  private discardedBytes = 0;
  private rejectedFrames = 0;

  get counters(): FrameReassemblerCounters {
    return { discardedBytes: this.discardedBytes, rejectedFrames: this.rejectedFrames };
  }

  /** Drop anything half-received. Call when the device goes away. */
  reset(): void {
    this.pending = null;
  }

  /**
   * Feed one transport chunk.
   *
   * The common case — nothing pending and the chunk is exactly one whole
   * frame — hands the chunk straight to `sink` without copying it.
   */
  push(chunk: Uint8Array, sink: FrameSink): void {
    if (this.pending === null && this.emitWholeChunk(chunk, sink)) return;
    this.pending = this.drain(this.join(chunk), sink);
  }

  private emitWholeChunk(chunk: Uint8Array, sink: FrameSink): boolean {
    const scan = scanEnvelope(chunk);
    if (scan.kind === 'opaque') {
      sink(chunk);
      return true;
    }
    if (scan.kind === 'frame' && scan.length === chunk.length) {
      sink(chunk);
      return true;
    }
    return false;
  }

  private join(chunk: Uint8Array): Uint8Array {
    if (this.pending === null) return chunk;
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    return joined;
  }

  /** Emit every whole frame in `buffer`; return whatever is left over. */
  private drain(buffer: Uint8Array, sink: FrameSink): Uint8Array | null {
    let offset = 0;
    while (offset < buffer.length) {
      if (buffer[offset] !== FRAME_MARKER) {
        offset = this.skipToMarker(buffer, offset);
        continue;
      }
      const scan = scanEnvelope(buffer, offset);
      if (scan.kind === 'incomplete') break;
      if (scan.kind === 'opaque') {
        sink(buffer.subarray(offset));
        return null;
      }
      if (scan.kind === 'invalid') {
        this.rejectedFrames++;
        this.discardedBytes++;
        offset++;
        continue;
      }
      sink(buffer.subarray(offset, offset + scan.length));
      offset += scan.length;
    }
    return offset < buffer.length ? buffer.slice(offset) : null;
  }

  /** Advance past bytes that cannot start a frame, counting them in bulk. */
  private skipToMarker(buffer: Uint8Array, offset: number): number {
    let next = offset;
    while (next < buffer.length && buffer[next] !== FRAME_MARKER) next++;
    this.discardedBytes += next - offset;
    return next;
  }
}
