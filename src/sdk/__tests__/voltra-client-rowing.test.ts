/**
 * Unit tests for the two-stage Rowing entry on VoltraClient (Bug 22).
 *
 * Verifies that:
 *   - `setMode(TrainingMode.Rowing)` auto-routes to enterRowMode + startRow
 *     and NEVER writes the motor-engage value
 *   - `enterRowMode()` writes the existing rowing workout-state command
 *   - `startRow()` writes the screen switch + vendor refresh and then schedules
 *     reasserts at +750 / +1750 / +3000 ms
 *   - `startRow()` requires `enterRowMode()` first
 *   - reassert ticks are cancelled by `setMode()` to a different mode
 *   - reassert ticks are cancelled by disconnect / cleanup
 *   - the action-code byte differs across distance presets
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { connectSetupReply } from '../../testing/device-replies';
import { BaseBLEAdapter } from '../../bluetooth/adapters/base';
import type { Device } from '../../bluetooth/adapters/types';
import { VoltraClient } from '../voltra-client';
import { CommandError, InvalidSettingError } from '../../errors';
import { hexToBytes } from '../../shared/utils';
import protocolData from '../../voltra/protocol/data/protocol-data.generated';
import type { ProtocolData } from '../../voltra/protocol/types';
import { TrainingMode } from '../../voltra/protocol/constants';
import { MOTOR_REPORT_VALUES, MOTOR_STATE_FIELD } from '../../voltra/protocol/device-state';
import type { RowStartActionKey } from '../../voltra/protocol/rowing-frames';

const protocol = protocolData as ProtocolData;
const ACTION = protocol.commands.rowing.actionCodes as Record<RowStartActionKey, number>;

class RecordingAdapter extends BaseBLEAdapter {
  readonly writes: Uint8Array[] = [];

  async scan(_timeout: number): Promise<Device[]> {
    return [];
  }

  async connect(_deviceId: string): Promise<void> {
    this.setConnectionState('connecting');
    this.setConnectionState('connected');
  }

  async disconnect(): Promise<void> {
    this.setConnectionState('disconnected');
  }

  async write(data: Uint8Array): Promise<void> {
    this.writes.push(new Uint8Array(data));
    // VW-403: connect() waits for the device's acceptance report, and control
    // setters wait for its core-state reply. Answer both as a device would.
    const setupReply = connectSetupReply(data);
    if (setupReply) this.emitNotification(setupReply);
  }
}

const device: Device = { id: 'device-x', name: 'VTR-XYZXYZ', rssi: -55 };

async function flushAndAwait<T>(promise: Promise<T>): Promise<T> {
  while (true) {
    const settled = await Promise.race([
      promise.then((value) => ({ done: true as const, value })),
      Promise.resolve().then(() => ({ done: false as const })),
    ]);
    if (settled.done) {
      return settled.value;
    }
    await vi.advanceTimersByTimeAsync(50);
  }
}

/** Find a recorded write by exact-byte match. */
function findWrite(adapter: RecordingAdapter, expected: Uint8Array): number {
  for (let i = 0; i < adapter.writes.length; i++) {
    const w = adapter.writes[i];
    if (w.length === expected.length && w.every((b, j) => b === expected[j])) return i;
  }
  return -1;
}

function containsSequence(frame: Uint8Array, sequence: number[]): boolean {
  for (let j = 0; j + sequence.length <= frame.length; j++) {
    if (sequence.every((b, k) => frame[j + k] === b)) return true;
  }
  return false;
}

function findWriteContaining(adapter: RecordingAdapter, sequence: number[]): number {
  return adapter.writes.findIndex((w) => containsSequence(w, sequence));
}

/** Find a write carrying the screen-switch rowing payload for `action`. */
function findRowScrSwitchWrite(adapter: RecordingAdapter, action: number): number {
  const { screenSwitchParamField, screenSwitchTrailer } = protocol.commands.rowing;
  return findWriteContaining(adapter, [
    0x01,
    0x00,
    ...hexToBytes(screenSwitchParamField),
    action,
    ...hexToBytes(screenSwitchTrailer),
  ]);
}

/** Find a write carrying the vendor state refresh payload. */
function findVendorRefreshWrite(adapter: RecordingAdapter): number {
  const { vendorCmd, vendorRefreshPayload } = protocol.commands.rowing;
  return findWriteContaining(adapter, [...hexToBytes(vendorCmd + vendorRefreshPayload)]);
}

describe('VoltraClient — Rowing two-stage entry (Bug 22)', () => {
  let adapter: RecordingAdapter;
  let client: VoltraClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    adapter = new RecordingAdapter();
    client = new VoltraClient({ adapter });
    await flushAndAwait(client.connect(device));
    adapter.writes.length = 0;
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
  });

  describe('setMode(Rowing) auto-route', () => {
    it('routes through the screen switch, never via the motor-engage write', async () => {
      await client.setMode(TrainingMode.Rowing);

      // The screen-switch commit for Just Row MUST appear.
      expect(findRowScrSwitchWrite(adapter, ACTION.JustRow)).not.toBe(-1);

      // Engaging the motor from the rowing screen is the Bug 22 regression.
      const engaged = MOTOR_REPORT_VALUES.engaged;
      const engageWrite = [
        0x01,
        0x00,
        ...hexToBytes(MOTOR_STATE_FIELD),
        engaged & 0xff,
        engaged >> 8,
      ];
      for (const frame of adapter.writes) {
        expect(containsSequence(frame, engageWrite)).toBe(false);
      }
    });

    it('marks the client as rowing-active afterward', async () => {
      await client.setMode(TrainingMode.Rowing);
      expect(client.isRowingActive).toBe(true);
    });

    it('writes the rowing workout-state frame followed by the screen switch + vendor refresh', async () => {
      await client.setMode(TrainingMode.Rowing);

      const enterRow = hexToBytes(protocol.commands.modes.rowing);
      const enterIdx = findWrite(adapter, enterRow);
      const scrIdx = findRowScrSwitchWrite(adapter, ACTION.JustRow);
      const refreshIdx = findVendorRefreshWrite(adapter);

      expect(enterIdx).not.toBe(-1);
      expect(scrIdx).toBeGreaterThan(enterIdx);
      expect(refreshIdx).toBeGreaterThan(scrIdx);
    });

    it('still accepts other training modes via the legacy single-shot path', async () => {
      await client.setMode(TrainingMode.WeightTraining);
      const expected = hexToBytes(protocol.commands.modes.weightTraining);
      expect(findWrite(adapter, expected)).not.toBe(-1);
    });
  });

  describe('enterRowMode()', () => {
    it('writes the existing rowing workout-state command', async () => {
      await client.enterRowMode();
      const expected = hexToBytes(protocol.commands.modes.rowing);
      expect(findWrite(adapter, expected)).not.toBe(-1);
    });

    it('does NOT yet engage rowing-active (sub-menu only)', async () => {
      await client.enterRowMode();
      expect(client.isRowingActive).toBe(false);
    });

    it('is idempotent — calling repeatedly is safe', async () => {
      await client.enterRowMode();
      await client.enterRowMode();
      const expected = hexToBytes(protocol.commands.modes.rowing);
      // Each call writes the workout-state command once.
      expect(
        adapter.writes.filter((w) => w.length === expected.length).length
      ).toBeGreaterThanOrEqual(2);
    });
  });

  describe('startRow()', () => {
    it('throws if enterRowMode() was not called first', async () => {
      await expect(client.startRow()).rejects.toBeInstanceOf(CommandError);
    });

    it('writes the screen switch with the Just Row action by default', async () => {
      await client.enterRowMode();
      adapter.writes.length = 0;

      await client.startRow();

      expect(findRowScrSwitchWrite(adapter, ACTION.JustRow)).not.toBe(-1);
    });

    it('writes the vendor state refresh frame after the screen switch', async () => {
      await client.enterRowMode();
      adapter.writes.length = 0;

      await client.startRow();

      const scrIdx = findRowScrSwitchWrite(adapter, ACTION.JustRow);
      const refreshIdx = findVendorRefreshWrite(adapter);
      expect(scrIdx).not.toBe(-1);
      expect(refreshIdx).toBeGreaterThan(scrIdx);
    });

    it('uses a different action code per distance preset', async () => {
      const presets = Object.keys(ACTION) as RowStartActionKey[];
      expect(new Set(Object.values(ACTION)).size).toBe(presets.length);

      for (const preset of presets) {
        const action = ACTION[preset];
        await client.enterRowMode();
        adapter.writes.length = 0;
        await client.startRow(preset);
        expect(findRowScrSwitchWrite(adapter, action)).not.toBe(-1);
        // Cancel pending reasserts before the next case to avoid leaks.
        await client.setMode(TrainingMode.Idle);
        adapter.writes.length = 0;
      }
    });

    it('rejects unknown distance presets', async () => {
      await client.enterRowMode();
      // @ts-expect-error invalid preset on purpose
      await expect(client.startRow('M999')).rejects.toBeInstanceOf(InvalidSettingError);
    });

    it('marks the client as rowing-active after a successful commit', async () => {
      await client.enterRowMode();
      await client.startRow();
      expect(client.isRowingActive).toBe(true);
    });
  });

  describe('reassert scheduling', () => {
    it('schedules reasserts at +750 / +1750 / +3000 ms after startRow()', async () => {
      await client.enterRowMode();
      await client.startRow('M500');
      adapter.writes.length = 0;

      // Tick 0 at +750 ms: re-issues the screen switch + vendor refresh.
      await vi.advanceTimersByTimeAsync(750);
      expect(findRowScrSwitchWrite(adapter, ACTION.M500)).not.toBe(-1);
      expect(findVendorRefreshWrite(adapter)).not.toBe(-1);

      adapter.writes.length = 0;

      // Tick 1 at +1750 ms (additional 1000 ms).
      await vi.advanceTimersByTimeAsync(1000);
      expect(findRowScrSwitchWrite(adapter, ACTION.M500)).not.toBe(-1);

      adapter.writes.length = 0;

      // Tick 2 at +3000 ms (additional 1250 ms).
      await vi.advanceTimersByTimeAsync(1250);
      expect(findRowScrSwitchWrite(adapter, ACTION.M500)).not.toBe(-1);

      adapter.writes.length = 0;

      // No more ticks scheduled.
      await vi.advanceTimersByTimeAsync(5000);
      expect(adapter.writes).toHaveLength(0);
    });

    it('cancels pending reasserts when setMode() is called for a non-Rowing mode', async () => {
      await client.enterRowMode();
      await client.startRow();
      adapter.writes.length = 0;

      // Switch out of Rowing before any tick fires.
      await client.setMode(TrainingMode.WeightTraining);
      const writesAfterSetMode = adapter.writes.length;

      // Advance well past the +3000 ms window.
      await vi.advanceTimersByTimeAsync(5000);

      // No additional rowing-related frames after setMode() returned.
      expect(findRowScrSwitchWrite(adapter, ACTION.JustRow)).toBe(-1);
      expect(adapter.writes).toHaveLength(writesAfterSetMode);
    });

    it('cancels pending reasserts on disconnect', async () => {
      await client.enterRowMode();
      await client.startRow();
      adapter.writes.length = 0;

      await client.disconnect();
      await vi.advanceTimersByTimeAsync(5000);

      expect(findRowScrSwitchWrite(adapter, ACTION.JustRow)).toBe(-1);
    });

    it('a second startRow() supersedes the first attempt', async () => {
      await client.enterRowMode();
      await client.startRow('JustRow');
      adapter.writes.length = 0;

      // Re-arm with a different distance before any tick fires.
      await client.startRow('M1000');
      adapter.writes.length = 0;

      // Advance past the original +3000 ms window — only ticks for the
      // second attempt should fire, and the first attempt's
      // ticks should NOT.
      await vi.advanceTimersByTimeAsync(3500);
      expect(findRowScrSwitchWrite(adapter, ACTION.JustRow)).toBe(-1);
      expect(findRowScrSwitchWrite(adapter, ACTION.M1000)).not.toBe(-1);
    });
  });

  describe('integration — full two-stage sequence', () => {
    it('emits the documented frame ordering for a Just-Row session', async () => {
      // Stage 1: enter row mode.
      await client.enterRowMode();
      const enterRowIdx = adapter.writes.length - 1;

      // Stage 2: commit Just Row.
      await client.startRow();
      const scrSwitchIdx = findRowScrSwitchWrite(adapter, ACTION.JustRow);
      const vendorRefreshIdx = findVendorRefreshWrite(adapter);

      // Ordering: [..., enterRow @ N-1, scrSwitch @ N, refresh @ N+1].
      expect(scrSwitchIdx).toBeGreaterThan(enterRowIdx);
      expect(vendorRefreshIdx).toBeGreaterThan(scrSwitchIdx);
    });
  });
});
