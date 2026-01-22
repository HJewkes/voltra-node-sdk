/**
 * React Hooks for Voltra SDK
 *
 * Provides React hooks for device scanning and connection management.
 *
 * @example
 * ```tsx
 * import { useScanner, useVoltraClient } from '@voltra/node-sdk/react';
 * import { WebBLEAdapter, BLE } from '@voltra/node-sdk';
 *
 * function DeviceScreen() {
 *   const adapter = useMemo(() => new WebBLEAdapter({ ble: BLE }), []);
 *   const { devices, isScanning, scan, error: scanError } = useScanner(adapter);
 *   const {
 *     client,
 *     connectionState,
 *     currentFrame,
 *     error: clientError,
 *     connect,
 *     disconnect,
 *   } = useVoltraClient(adapter);
 *
 *   return (
 *     <View>
 *       <Button onPress={() => scan()} disabled={isScanning}>
 *         {isScanning ? 'Scanning...' : 'Scan for Devices'}
 *       </Button>
 *       {devices.map((device) => (
 *         <Button key={device.id} onPress={() => connect(device)}>
 *           {device.name ?? device.id}
 *         </Button>
 *       ))}
 *       {connectionState === 'connected' && currentFrame && (
 *         <Text>Position: {currentFrame.position}</Text>
 *       )}
 *     </View>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { BLEAdapter } from '../bluetooth/adapters/types';
import type { DiscoveredDevice } from '../bluetooth/models/device';
import type { TelemetryFrame } from '../voltra/models/telemetry';
import type { VoltraConnectionState } from '../voltra/models/connection';
import type { VoltraDeviceSettings, VoltraRecordingState } from '../voltra/models/device';
import { filterVoltraDevices } from '../voltra/models/device-filter';
import { VoltraClient } from '../sdk/voltra-client';
import type { ScanOptions } from '../sdk/types';

// =============================================================================
// useScanner
// =============================================================================

/**
 * Options for useScanner hook.
 */
export interface UseScannerOptions {
  /**
   * Whether to automatically filter for Voltra devices only.
   * Default: true
   */
  filterVoltra?: boolean;

  /**
   * Default scan timeout in milliseconds.
   * Default: 10000
   */
  defaultTimeout?: number;
}

/**
 * Return type for useScanner hook.
 */
export interface UseScannerResult {
  /** Discovered devices from the last scan */
  devices: DiscoveredDevice[];
  /** Whether a scan is currently in progress */
  isScanning: boolean;
  /** Error from the last scan attempt, if any */
  error: Error | null;
  /** Start scanning for devices */
  scan: (options?: ScanOptions) => Promise<DiscoveredDevice[]>;
  /** Clear the discovered devices list */
  clearDevices: () => void;
}

/**
 * Hook for scanning for Voltra devices.
 *
 * @param adapter BLE adapter to use for scanning
 * @param options Scanner options
 * @returns Scanner state and controls
 */
export function useScanner(
  adapter: BLEAdapter | null,
  options: UseScannerOptions = {}
): UseScannerResult {
  const { filterVoltra = true, defaultTimeout = 10000 } = options;

  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const scan = useCallback(
    async (scanOptions: ScanOptions = {}): Promise<DiscoveredDevice[]> => {
      if (!adapter) {
        const err = new Error('No adapter provided');
        setError(err);
        throw err;
      }

      const timeout = scanOptions.timeout ?? defaultTimeout;
      const shouldFilter = scanOptions.filterVoltra ?? filterVoltra;

      setIsScanning(true);
      setError(null);

      try {
        const foundDevices = await adapter.scan(timeout);
        const filtered = shouldFilter ? filterVoltraDevices(foundDevices) : foundDevices;
        setDevices(filtered);
        return filtered;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsScanning(false);
      }
    },
    [adapter, defaultTimeout, filterVoltra]
  );

  const clearDevices = useCallback(() => {
    setDevices([]);
    setError(null);
  }, []);

  return { devices, isScanning, error, scan, clearDevices };
}

// =============================================================================
// useVoltraClient
// =============================================================================

/**
 * Options for useVoltraClient hook.
 */
export interface UseVoltraClientOptions {
  /**
   * Enable auto-reconnect on connection loss.
   * Default: false
   */
  autoReconnect?: boolean;
}

/**
 * Return type for useVoltraClient hook.
 */
export interface UseVoltraClientResult {
  /** The VoltraClient instance (null until first connection) */
  client: VoltraClient | null;
  /** Current connection state */
  connectionState: VoltraConnectionState;
  /** Whether connected to a device */
  isConnected: boolean;
  /** Current recording state */
  recordingState: VoltraRecordingState;
  /** Whether currently recording */
  isRecording: boolean;
  /** Current device settings */
  settings: VoltraDeviceSettings;
  /** Most recent telemetry frame */
  currentFrame: TelemetryFrame | null;
  /** Error from the last operation, if any */
  error: Error | null;
  /** Connect to a device */
  connect: (device: DiscoveredDevice) => Promise<void>;
  /** Disconnect from current device */
  disconnect: () => Promise<void>;
  /** Set weight in pounds */
  setWeight: (lbs: number) => Promise<void>;
  /** Set chains in pounds */
  setChains: (lbs: number) => Promise<void>;
  /** Set eccentric adjustment */
  setEccentric: (percent: number) => Promise<void>;
  /** Prepare for recording */
  prepareRecording: () => Promise<void>;
  /** Start recording */
  startRecording: () => Promise<void>;
  /** Stop recording */
  stopRecording: () => Promise<void>;
  /** End current set (stay in workout mode) */
  endSet: () => Promise<void>;
}

const DEFAULT_SETTINGS: VoltraDeviceSettings = {
  weight: 0,
  chains: 0,
  eccentric: 0,
};

/**
 * Hook for managing a Voltra device connection.
 *
 * @param adapter BLE adapter to use for connection
 * @param options Client options
 * @returns Client state and controls
 */
export function useVoltraClient(
  adapter: BLEAdapter | null,
  options: UseVoltraClientOptions = {}
): UseVoltraClientResult {
  const { autoReconnect = false } = options;

  // Client instance (persisted across renders)
  const clientRef = useRef<VoltraClient | null>(null);

  // State
  const [connectionState, setConnectionState] = useState<VoltraConnectionState>('disconnected');
  const [recordingState, setRecordingState] = useState<VoltraRecordingState>('idle');
  const [settings, setSettings] = useState<VoltraDeviceSettings>(DEFAULT_SETTINGS);
  const [currentFrame, setCurrentFrame] = useState<TelemetryFrame | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Create client when adapter changes
  useEffect(() => {
    if (!adapter) {
      clientRef.current = null;
      return;
    }

    const client = new VoltraClient({ adapter, autoReconnect });
    clientRef.current = client;

    // Subscribe to events
    const unsubscribe = client.subscribe((event) => {
      switch (event.type) {
        case 'connectionStateChanged':
          setConnectionState(event.state);
          break;
        case 'recordingStateChanged':
          setRecordingState(event.state);
          break;
        case 'frame':
          setCurrentFrame(event.frame);
          break;
        case 'error':
          setError(event.error);
          break;
        case 'connected':
          setSettings(client.settings);
          setError(null);
          break;
        case 'disconnected':
          setCurrentFrame(null);
          setSettings(DEFAULT_SETTINGS);
          break;
      }
    });

    return () => {
      unsubscribe();
      client.dispose();
      clientRef.current = null;
    };
  }, [adapter, autoReconnect]);

  // Connection methods
  const connect = useCallback(async (device: DiscoveredDevice): Promise<void> => {
    if (!clientRef.current) {
      throw new Error('No adapter provided');
    }
    setError(null);
    try {
      await clientRef.current.connect(device);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    }
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    if (!clientRef.current) return;
    await clientRef.current.disconnect();
  }, []);

  // Settings methods
  const setWeight = useCallback(async (lbs: number): Promise<void> => {
    if (!clientRef.current) throw new Error('Not connected');
    await clientRef.current.setWeight(lbs);
    setSettings(clientRef.current.settings);
  }, []);

  const setChains = useCallback(async (lbs: number): Promise<void> => {
    if (!clientRef.current) throw new Error('Not connected');
    await clientRef.current.setChains(lbs);
    setSettings(clientRef.current.settings);
  }, []);

  const setEccentric = useCallback(async (percent: number): Promise<void> => {
    if (!clientRef.current) throw new Error('Not connected');
    await clientRef.current.setEccentric(percent);
    setSettings(clientRef.current.settings);
  }, []);

  // Recording methods
  const prepareRecording = useCallback(async (): Promise<void> => {
    if (!clientRef.current) throw new Error('Not connected');
    await clientRef.current.prepareRecording();
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    if (!clientRef.current) throw new Error('Not connected');
    await clientRef.current.startRecording();
  }, []);

  const stopRecording = useCallback(async (): Promise<void> => {
    if (!clientRef.current) throw new Error('Not connected');
    await clientRef.current.stopRecording();
  }, []);

  const endSet = useCallback(async (): Promise<void> => {
    if (!clientRef.current) throw new Error('Not connected');
    await clientRef.current.endSet();
  }, []);

  return {
    client: clientRef.current,
    connectionState,
    isConnected: connectionState === 'connected',
    recordingState,
    isRecording: recordingState === 'active',
    settings,
    currentFrame,
    error,
    connect,
    disconnect,
    setWeight,
    setChains,
    setEccentric,
    prepareRecording,
    startRecording,
    stopRecording,
    endSet,
  };
}
