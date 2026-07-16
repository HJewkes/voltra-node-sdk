/**
 * MockBLEAdapter settings-cascade tests
 *
 * The mock must surface user-set weight/chains the same way real hardware
 * does: via the cmd=0x10 settings-update cascade decoded by `onSettingsUpdate`.
 * Without this, a no-hardware consumer reads `weightLbs: null` and every
 * mass/force readout renders empty.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockBLEAdapter } from '../mock';
import { detectSettingCommand } from '../mock/notifications';
import { decodeNotification } from '../../../voltra/protocol/telemetry-decoder';
import {
  getAvailableChains,
  getAvailableWeights,
  getChainsCommand,
  getWeightCommand,
} from '../../../voltra/protocol/commands';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function collect(adapter: MockBLEAdapter): Uint8Array[] {
  const notifications: Uint8Array[] = [];
  adapter.onNotification((data) => notifications.push(data));
  return notifications;
}

/** Extract every DeviceSettings bag decoded from the captured notifications. */
function settingsFrom(notifications: Uint8Array[]) {
  return notifications
    .map((n) => decodeNotification(n))
    .filter((r): r is { type: 'settings_update'; settings: Record<string, number> } =>
      Boolean(r && r.type === 'settings_update')
    )
    .map((r) => r.settings);
}

async function connectSeeded(adapter: MockBLEAdapter): Promise<void> {
  const connectPromise = adapter.connect('mock-voltra-001');
  vi.advanceTimersByTime(0);
  await connectPromise;
  // Fire the deferred connect-time seed timer (setTimeout 0) without ticking
  // the 91ms telemetry interval.
  await vi.advanceTimersByTimeAsync(1);
}

describe('MockBLEAdapter settings cascade', () => {
  it('seeds a non-null weight cascade on connect', async () => {
    const adapter = new MockBLEAdapter({ connectDelayMs: 0, weight: 135 });
    const notifications = collect(adapter);

    await connectSeeded(adapter);

    const weights = settingsFrom(notifications)
      .map((s) => s.baseWeight)
      .filter((w): w is number => typeof w === 'number');
    expect(weights).toContain(135);

    await adapter.disconnect();
  });

  it('echoes a settings cascade reflecting setWeight', async () => {
    const target = getAvailableWeights().find((w) => w >= 75) ?? getAvailableWeights()[0];
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const notifications = collect(adapter);
    await connectSeeded(adapter);
    notifications.length = 0; // drop the connect seed

    await adapter.write(getWeightCommand(target)!);

    const bags = settingsFrom(notifications);
    expect(bags.some((s) => s.baseWeight === target)).toBe(true);

    await adapter.disconnect();
  });

  it('echoes a settings cascade reflecting setChains', async () => {
    const target = getAvailableChains().find((c) => c >= 20) ?? getAvailableChains().at(-1)!;
    const adapter = new MockBLEAdapter({ connectDelayMs: 0 });
    const notifications = collect(adapter);
    await connectSeeded(adapter);
    notifications.length = 0;

    await adapter.write(getChainsCommand(target)!);

    const bags = settingsFrom(notifications);
    expect(bags.some((s) => s.chains === target)).toBe(true);

    await adapter.disconnect();
  });

  it('detectSettingCommand reverses weight/chains writes and ignores others', () => {
    const w = getAvailableWeights()[0];
    const c = getAvailableChains().at(-1)!;
    expect(detectSettingCommand(getWeightCommand(w)!)).toEqual({ baseWeight: w });
    expect(detectSettingCommand(getChainsCommand(c)!)).toEqual({ chains: c });
    expect(detectSettingCommand(new Uint8Array([0x01, 0x02, 0x03]))).toBeNull();
  });
});
