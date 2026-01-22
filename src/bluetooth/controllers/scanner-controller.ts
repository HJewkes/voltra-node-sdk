/**
 * Scanner Controller
 *
 * Manages BLE device scanning with auto-scan functionality.
 * This is a generic controller that can be configured with a device filter.
 */

import type { BLEAdapter } from '../adapters';
import { type DiscoveredDevice } from '../models/device';
import type { BLEEnvironmentInfo } from '../models/environment';

/**
 * Device filter function type.
 * Used to filter discovered devices (e.g., by name prefix).
 */
export type DeviceFilter = (devices: DiscoveredDevice[]) => DiscoveredDevice[];

/**
 * Scanner state snapshot.
 */
export interface ScannerState {
  isScanning: boolean;
  discoveredDevices: DiscoveredDevice[];
  lastScanTime: number;
  error: string | null;
}

/**
 * Scanner event types.
 */
export type ScannerEvent =
  | { type: 'scanStarted' }
  | { type: 'scanCompleted'; devices: DiscoveredDevice[] }
  | { type: 'scanFailed'; error: string };

/**
 * Scanner event listener.
 */
export type ScannerEventListener = (event: ScannerEvent) => void;

/**
 * Scanner configuration.
 */
export interface ScannerConfig {
  scanDurationMs: number;
  scanIntervalMs: number;
}

/**
 * Controller for BLE device scanning.
 */
export class ScannerController {
  private _isScanning = false;
  private _discoveredDevices: DiscoveredDevice[] = [];
  private _lastScanTime = 0;
  private _error: string | null = null;

  private _autoScanInterval: ReturnType<typeof setInterval> | null = null;
  private _listeners: Set<ScannerEventListener> = new Set();

  constructor(
    private adapter: BLEAdapter,
    private _environment: BLEEnvironmentInfo,
    private config: ScannerConfig,
    private deviceFilter?: DeviceFilter
  ) {}

  /**
   * Get current scanner state.
   */
  getState(): ScannerState {
    return {
      isScanning: this._isScanning,
      discoveredDevices: this._discoveredDevices,
      lastScanTime: this._lastScanTime,
      error: this._error,
    };
  }

  /**
   * Subscribe to scanner events.
   */
  subscribe(listener: ScannerEventListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private emit(event: ScannerEvent): void {
    this._listeners.forEach((listener) => listener(event));
  }

  /**
   * Scan for devices.
   */
  async scan(): Promise<DiscoveredDevice[]> {
    // Don't scan if already scanning
    if (this._isScanning) {
      return this._discoveredDevices;
    }

    this._isScanning = true;
    this._error = null;
    this.emit({ type: 'scanStarted' });

    try {
      const devices = await this.adapter.scan(this.config.scanDurationMs / 1000);
      // Apply device filter if provided, otherwise return all devices
      const filteredDevices = this.deviceFilter
        ? this.deviceFilter(devices as DiscoveredDevice[])
        : (devices as DiscoveredDevice[]);

      this._discoveredDevices = filteredDevices;
      this._lastScanTime = Date.now();
      this._isScanning = false;

      this.emit({ type: 'scanCompleted', devices: filteredDevices });
      return filteredDevices;
    } catch (e: unknown) {
      this._isScanning = false;
      const errorMsg = e instanceof Error ? e.message : String(e);

      // User cancelled device picker (web) - not an error
      if (errorMsg.includes('NotFoundError')) {
        this._error = null;
        this.emit({ type: 'scanCompleted', devices: [] });
        return [];
      }

      // On web, "permission" errors are expected when scan is called without user gesture
      // Don't show these as errors - user just needs to click the scan button
      if (this._environment.requiresUserGesture && errorMsg.includes('permission')) {
        this._error = null;
        this.emit({ type: 'scanCompleted', devices: [] });
        return [];
      }

      // Categorize errors
      if (errorMsg.includes('permission') || errorMsg.includes('Unauthorized')) {
        this._error = 'Bluetooth permission required. Please enable in Settings.';
      } else if (errorMsg.includes('Timeout') || errorMsg.includes('PoweredOff')) {
        this._error = 'Please enable Bluetooth on your device.';
      } else {
        this._error = `Scan failed: ${errorMsg}`;
      }

      this.emit({ type: 'scanFailed', error: this._error ?? 'Unknown error' });
      return [];
    }
  }

  /**
   * Start auto-scanning.
   * Returns cleanup function.
   */
  startAutoScan(isConnected: () => boolean): () => void {
    // Clear existing intervals
    this.stopAutoScan();

    // Initial scan after short delay
    setTimeout(() => {
      if (!isConnected()) {
        this.scan();
      }
    }, 500);

    // Periodic auto-scan when not connected
    this._autoScanInterval = setInterval(() => {
      if (!this._isScanning && !isConnected()) {
        this.scan();
      }
    }, this.config.scanIntervalMs);

    return () => this.stopAutoScan();
  }

  /**
   * Stop auto-scanning.
   */
  stopAutoScan(): void {
    if (this._autoScanInterval) {
      clearInterval(this._autoScanInterval);
      this._autoScanInterval = null;
    }
  }

  /**
   * Clear error state.
   */
  clearError(): void {
    this._error = null;
  }

  /**
   * Cleanup resources.
   */
  dispose(): void {
    this.stopAutoScan();
    this._listeners.clear();
  }
}
