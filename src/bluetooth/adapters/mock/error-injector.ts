/**
 * Error injection framework for MockBLEAdapter.
 *
 * Intercepts the mock adapter's notification and connection pipelines to
 * simulate device failures. Each error type is a strategy that hooks into
 * specific points. Multiple errors can be composed simultaneously.
 */

import type {
  ErrorScenarioType,
  ErrorConfig,
  ErrorScenarioEntry,
  DisconnectConfig,
  AuthTimeoutConfig,
  NotificationDropConfig,
  MalformedFrameConfig,
  ReconnectCycleConfig,
} from './types';

export interface ErrorInjectorHost {
  triggerDisconnect(): void;
  triggerReconnect(): void;
}

export class ErrorInjector {
  private scenarios: ErrorScenarioEntry[] = [];
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectCycleTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rng: () => number;

  constructor(rng?: () => number) {
    this.rng = rng ?? Math.random;
  }

  get active(): boolean {
    return this.scenarios.length > 0;
  }

  inject(type: ErrorScenarioType, config: ErrorConfig): void {
    this.scenarios.push({ type, config });
  }

  clearAll(): void {
    this.scenarios = [];
    this.clearTimers();
  }

  hasScenario(type: ErrorScenarioType): boolean {
    return this.scenarios.some((s) => s.type === type);
  }

  getConfig<T extends ErrorConfig>(type: ErrorScenarioType): T | undefined {
    const entry = this.scenarios.find((s) => s.type === type);
    return entry?.config as T | undefined;
  }

  /**
   * Start time-based error scenarios (disconnect, reconnectCycle).
   * Called when the adapter connects successfully.
   */
  startTimers(host: ErrorInjectorHost): void {
    const disconnectCfg = this.getConfig<DisconnectConfig>('disconnect');
    if (disconnectCfg) {
      this.disconnectTimer = setTimeout(() => {
        host.triggerDisconnect();
      }, disconnectCfg.afterMs);
    }

    const reconnectCfg = this.getConfig<ReconnectCycleConfig>('reconnectCycle');
    if (reconnectCfg) {
      this.reconnectCycleTimer = setTimeout(() => {
        host.triggerDisconnect();
        this.reconnectTimer = setTimeout(() => {
          host.triggerReconnect();
        }, reconnectCfg.reconnectDelayMs);
      }, reconnectCfg.disconnectAfterMs);
    }
  }

  /**
   * Filter a notification frame. Returns null if the frame should be dropped,
   * a corrupted copy if malformed, or the original if no error applies.
   */
  filterNotification(data: Uint8Array): Uint8Array | null {
    if (!this.active) return data;

    const dropCfg = this.getConfig<NotificationDropConfig>('notificationDrop');
    if (dropCfg && this.rng() < dropCfg.dropRate) {
      return null;
    }

    const malformedCfg = this.getConfig<MalformedFrameConfig>('malformedFrame');
    if (malformedCfg && this.rng() < malformedCfg.corruptionRate) {
      return this.corruptFrame(data);
    }

    return data;
  }

  /**
   * Check if authTimeout is configured. If so, the connect should hang
   * and then reject after the configured timeout.
   */
  shouldBlockAuth(): AuthTimeoutConfig | undefined {
    return this.getConfig<AuthTimeoutConfig>('authTimeout');
  }

  clearTimers(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.reconnectCycleTimer) {
      clearTimeout(this.reconnectCycleTimer);
      this.reconnectCycleTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private corruptFrame(data: Uint8Array): Uint8Array {
    const corrupted = new Uint8Array(data);
    if (corrupted.length > 4) {
      // Corrupt a byte in the payload (after the 4-byte header)
      const idx = 4 + Math.floor(this.rng() * (corrupted.length - 4));
      corrupted[idx] = corrupted[idx] ^ 0xff;
    } else {
      // Truncate short frames
      return corrupted.subarray(0, Math.max(1, corrupted.length - 1));
    }
    return corrupted;
  }
}
