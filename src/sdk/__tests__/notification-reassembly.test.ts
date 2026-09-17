/**
 * VW-409 — the notification path treats a notification as a transport chunk.
 *
 * Every capture so far has carried exactly one whole frame per notification,
 * so these tests are the ones that would fail on a transport that does not
 * guarantee that. They use the real decoder: the assertion is which typed
 * event came out, not which bytes went in.
 */

import { describe, it, expect, vi } from 'vitest';
import { createNotificationHandler, type NotificationCallbacks } from '../notification-dispatcher';
import { FrameReassembler } from '../frame-reassembler';
import { sealEnvelope } from '../../voltra/protocol/frame-envelope';
import {
  buildEnvelopedFrame,
  buildVendorPerRepFrame,
  buildVendorSummaryFrame,
  VendorSchemaVersion,
} from '../../voltra/protocol/_factories';
import { encodeBulkParamResponse } from '../../voltra/protocol/telemetry-decoder';
import { ParamIdHex } from '../../voltra/protocol/constants';

/** A frame type whose size does not fit the single-byte length field. */
const EXTENDED_FRAME_TYPE = 0x09;

function makeCallbacks(): NotificationCallbacks & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onRawFrame: vi.fn(),
    onFrame: vi.fn(),
    onModeConfirmed: vi.fn(),
    onSettingsUpdate: vi.fn(),
    onStateDump: vi.fn(),
    onBatteryUpdate: vi.fn(),
    onPerRep: vi.fn(),
    onSummary: vi.fn(),
    onSetSummary: vi.fn(),
    onInProgress: vi.fn(),
    onConnectionAcceptance: vi.fn(),
  } as NotificationCallbacks & Record<string, ReturnType<typeof vi.fn>>;
}

const perRep = (repCount: number): Uint8Array =>
  buildVendorPerRepFrame({ motionPhase: 'pull', frameCounter: 1, setCounter: 1, repCount });

const summary = (repCount: number): Uint8Array =>
  buildVendorSummaryFrame({
    schemaVersion: VendorSchemaVersion.Weight,
    setCounter: 1,
    repCount,
  });

const settingsReply = (weight: number): Uint8Array =>
  encodeBulkParamResponse([{ paramIdHex: ParamIdHex.BASE_WEIGHT, value: weight }]);

describe('notification reassembly (VW-409)', () => {
  it('delivers exactly one event however a frame is split across notifications', () => {
    const frame = perRep(7);

    for (let cut = 1; cut < frame.length; cut++) {
      const callbacks = makeCallbacks();
      const handler = createNotificationHandler(callbacks);

      handler(frame.subarray(0, cut));
      handler(frame.subarray(cut));

      expect(callbacks.onPerRep, `split at ${cut}`).toHaveBeenCalledOnce();
      expect(callbacks.onPerRep.mock.calls[0][0]).toMatchObject({ repCount: 7 });
    }
  });

  it('delivers one event per frame when a notification carries two', () => {
    const callbacks = makeCallbacks();
    const handler = createNotificationHandler(callbacks);
    const first = perRep(1);
    const second = perRep(2);

    const both = new Uint8Array(first.length + second.length);
    both.set(first);
    both.set(second, first.length);
    handler(both);

    expect(callbacks.onPerRep).toHaveBeenCalledTimes(2);
    expect(callbacks.onPerRep.mock.calls[0][0]).toMatchObject({ repCount: 1 });
    expect(callbacks.onPerRep.mock.calls[1][0]).toMatchObject({ repCount: 2 });
  });

  it('does not let a frame whose checksum fails reach device state', () => {
    const callbacks = makeCallbacks();
    const handler = createNotificationHandler(callbacks);
    const frame = settingsReply(60);

    handler(frame);
    expect(callbacks.onSettingsUpdate).toHaveBeenCalledOnce();

    const corrupted = frame.slice();
    corrupted[corrupted.length - 3] ^= 0xff;
    handler(corrupted);

    expect(callbacks.onSettingsUpdate).toHaveBeenCalledOnce();
  });

  it('discards bytes before a marker and still delivers the frame after them', () => {
    const callbacks = makeCallbacks();
    const handler = createNotificationHandler(callbacks);
    const frame = perRep(3);

    const withGarbage = new Uint8Array(3 + frame.length);
    withGarbage.set([0x01, 0x02, 0x03]);
    withGarbage.set(frame, 3);
    handler(withGarbage);

    expect(callbacks.onPerRep).toHaveBeenCalledOnce();
    expect(callbacks.onPerRep.mock.calls[0][0]).toMatchObject({ repCount: 3 });
  });

  it('tells two same-length frames apart by command, not by length', () => {
    const callbacks = makeCallbacks();
    const handler = createNotificationHandler(callbacks);
    const length = summary(1).length;

    handler(
      buildVendorPerRepFrame(
        { motionPhase: 'pull', frameCounter: 1, setCounter: 1, repCount: 4 },
        { totalLength: length }
      )
    );
    handler(summary(5));

    expect(callbacks.onPerRep).toHaveBeenCalledOnce();
    expect(callbacks.onPerRep.mock.calls[0][0]).toMatchObject({ repCount: 4 });
    expect(callbacks.onSummary).toHaveBeenCalledOnce();
    expect(callbacks.onSummary.mock.calls[0][0]).toMatchObject({ repCount: 5 });
  });

  it('keeps one device’s half-received frame out of another device’s buffer', () => {
    const first = makeCallbacks();
    const second = makeCallbacks();
    const handlerA = createNotificationHandler(first);
    const handlerB = createNotificationHandler(second);
    const frame = perRep(9);
    const cut = 20;

    handlerA(frame.subarray(0, cut));
    handlerB(frame.subarray(cut));

    expect(first.onPerRep).not.toHaveBeenCalled();
    expect(second.onPerRep).not.toHaveBeenCalled();

    handlerA(frame.subarray(cut));

    expect(first.onPerRep).toHaveBeenCalledOnce();
    expect(second.onPerRep).not.toHaveBeenCalled();
  });

  it('fires onRawFrame once per notification, not once per frame', () => {
    const callbacks = makeCallbacks();
    const handler = createNotificationHandler(callbacks);
    const first = perRep(1);
    const second = perRep(2);

    const both = new Uint8Array(first.length + second.length);
    both.set(first);
    both.set(second, first.length);
    handler(both);

    expect(callbacks.onRawFrame).toHaveBeenCalledOnce();
    expect(callbacks.onRawFrame).toHaveBeenCalledWith(both);
    expect(callbacks.onPerRep).toHaveBeenCalledTimes(2);
  });
});

describe('FrameReassembler', () => {
  it('hands a whole-frame notification on without copying it', () => {
    const reassembler = new FrameReassembler();
    const frame = perRep(1);
    const seen: Uint8Array[] = [];

    reassembler.push(frame, (f) => seen.push(f));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(frame);
  });

  it('passes an extended-length frame through unchanged', () => {
    const reassembler = new FrameReassembler();
    const frame = buildEnvelopedFrame(0, new Uint8Array(4));
    frame[2] = EXTENDED_FRAME_TYPE;
    sealEnvelope(frame);
    const original = frame.slice();
    const seen: Uint8Array[] = [];

    reassembler.push(frame, (f) => seen.push(f));

    expect(seen).toHaveLength(1);
    expect(Array.from(seen[0])).toEqual(Array.from(original));
  });

  it('counts discarded garbage in bulk and counts a rejected frame', () => {
    const reassembler = new FrameReassembler();
    const frame = perRep(1);
    const corrupted = frame.slice();
    corrupted[corrupted.length - 3] ^= 0xff;

    const noise = new Uint8Array(5);
    const buffer = new Uint8Array(noise.length + corrupted.length);
    buffer.set(noise);
    buffer.set(corrupted, noise.length);

    const seen: Uint8Array[] = [];
    reassembler.push(buffer, (f) => seen.push(f));

    expect(seen).toHaveLength(0);
    expect(reassembler.counters.rejectedFrames).toBe(1);
    expect(reassembler.counters.discardedBytes).toBeGreaterThanOrEqual(noise.length);
  });

  it('forgets a half-received frame on reset', () => {
    const reassembler = new FrameReassembler();
    const frame = perRep(1);
    const seen: Uint8Array[] = [];

    reassembler.push(frame.subarray(0, 10), (f) => seen.push(f));
    reassembler.reset();
    reassembler.push(frame.subarray(10), (f) => seen.push(f));

    expect(seen).toHaveLength(0);
  });
});
