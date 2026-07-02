/**
 * Internal bridge — wrap a `Peripheral` as a `BLEAdapter`.
 *
 * Phase 0 (2026-05-08) of the BluetoothHost + Peripheral split. The
 * `VoltraClient` internals still consume the legacy `BLEAdapter` shape
 * (`this.adapter.write(...)`, `this.adapter.onConnectionStateChange(...)`,
 * etc). To accept a `Peripheral` in the constructor without rewriting all
 * 2000+ lines of the client, we wrap the peripheral here.
 *
 * - `scan()` / `connect()` are unreachable: a peripheral is ALREADY dialed
 *   when handed to `VoltraClient`. The client's `scan()`/`connect()`
 *   methods short-circuit when this bridge is in use.
 * - `write` / `disconnect` / `onNotification` map directly.
 * - `onConnectionStateChange` translates `Peripheral.status` transitions
 *   back into the legacy `ConnectionState` enum so the disconnect monitor
 *   keeps working unchanged.
 * - `isLinkAlive()` derives from `peripheral.status === 'connected'`.
 *
 * NOT exported from the SDK public surface — internal-only.
 */

import type {
  BLEAdapter,
  ConnectionState,
  ConnectionStateCallback,
  ConnectOptions,
  Device,
  NotificationCallback,
  Peripheral,
  PeripheralStatus,
} from '../bluetooth/adapters/types';
import { PeripheralLost } from '../bluetooth/adapters/types';

/**
 * Map a `PeripheralStatus` to its legacy `ConnectionState` equivalent.
 *
 * `'lost'` collapses to `'disconnected'` because the legacy enum has no
 * intermediate "link died but not yet cleaned up" state — the SDK's
 * `ensureConnected` / disconnect monitor handle the consequences.
 */
function statusToConnectionState(status: PeripheralStatus): ConnectionState {
  switch (status) {
    case 'connecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'disconnecting':
      return 'disconnecting';
    case 'disconnected':
    case 'lost':
      return 'disconnected';
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = status;
      void _exhaustive;
      return 'disconnected';
    }
  }
}

/**
 * Adapter facade over a `Peripheral`. Used internally by `VoltraClient`
 * when constructed with `{ peripheral }` rather than `{ adapter }`.
 */
export class PeripheralAdapterBridge implements BLEAdapter {
  /**
   * The wrapped peripheral. Public-readonly so the SDK's diagnostic
   * surface (`VoltraClient.unsafeDiagnostics()`) can reach the typed
   * Peripheral handle without piercing this class.
   */
  readonly peripheral: Peripheral;

  /**
   * Last-observed legacy connection state. Updated synchronously inside
   * the peripheral's status-change callback so legacy `getConnectionState`
   * callers see consistent values.
   */
  private connectionState: ConnectionState;

  private notificationCallbacks: NotificationCallback[] = [];
  private stateCallbacks: ConnectionStateCallback[] = [];
  private statusUnsubscribe: (() => void) | null = null;
  private notificationUnsubscribe: (() => void) | null = null;

  constructor(peripheral: Peripheral) {
    this.peripheral = peripheral;
    this.connectionState = statusToConnectionState(peripheral.status);

    this.statusUnsubscribe = peripheral.onStatusChange((status) => {
      const next = statusToConnectionState(status);
      if (next !== this.connectionState) {
        this.connectionState = next;
        for (const cb of [...this.stateCallbacks]) {
          try {
            cb(next);
          } catch (e) {
            console.error('[PeripheralAdapterBridge] state callback error:', e);
          }
        }
      }
    });

    this.notificationUnsubscribe = peripheral.onNotification((data) => {
      for (const cb of [...this.notificationCallbacks]) {
        try {
          cb(data);
        } catch (e) {
          console.error('[PeripheralAdapterBridge] notification callback error:', e);
        }
      }
    });
  }

  /**
   * Scan is unreachable on a peripheral-backed client — by the time a
   * Peripheral exists, scanning has already happened at the host level.
   * Throwing here surfaces misuse early; the SDK guards this path so
   * legitimate callers never reach it.
   */
  async scan(_timeout: number): Promise<Device[]> {
    throw new Error(
      'scan() is unreachable on a Peripheral-backed VoltraClient. ' +
        'Use BluetoothHost.scan() instead.'
    );
  }

  /**
   * Same reasoning as `scan` — peripheral is already dialed. The
   * client.connect() call short-circuits to skip this when a bridge is
   * present.
   */
  async connect(_deviceId: string, _options?: ConnectOptions): Promise<void> {
    if (this.peripheral.status === 'connected') {
      // Idempotent path: client.connect was called against an already-
      // dialed peripheral. No-op.
      return;
    }
    throw new Error(
      `Peripheral status is ${this.peripheral.status} — cannot dial through the bridge`
    );
  }

  async disconnect(): Promise<void> {
    await this.peripheral.disconnect();
  }

  async write(data: Uint8Array): Promise<void> {
    try {
      await this.peripheral.write(data);
    } catch (e) {
      // Translate PeripheralLost to the legacy 'Not connected' shape so
      // existing VoltraClient.writeFrame error-handling still recognizes
      // the failure mode. (writeFrame catches any error and flips state.)
      if (e instanceof PeripheralLost) {
        throw new Error(`Not connected to device: ${e.message}`, { cause: e });
      }
      throw e;
    }
  }

  onNotification(callback: NotificationCallback): () => void {
    this.notificationCallbacks.push(callback);
    return () => {
      const idx = this.notificationCallbacks.indexOf(callback);
      if (idx >= 0) this.notificationCallbacks.splice(idx, 1);
    };
  }

  onConnectionStateChange(callback: ConnectionStateCallback): () => void {
    this.stateCallbacks.push(callback);
    return () => {
      const idx = this.stateCallbacks.indexOf(callback);
      if (idx >= 0) this.stateCallbacks.splice(idx, 1);
    };
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  isConnected(): boolean {
    return this.peripheral.status === 'connected';
  }

  isLinkAlive(): boolean {
    return this.peripheral.status === 'connected';
  }

  /**
   * Tear down internal subscriptions when the client is disposed. Idempotent.
   */
  dispose(): void {
    this.statusUnsubscribe?.();
    this.statusUnsubscribe = null;
    this.notificationUnsubscribe?.();
    this.notificationUnsubscribe = null;
    this.notificationCallbacks = [];
    this.stateCallbacks = [];
  }
}
