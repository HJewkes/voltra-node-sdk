/**
 * React Hooks for Voltra SDK
 *
 * Clean, focused hooks for device scanning and state management.
 *
 * @example
 * ```tsx
 * import { VoltraManager } from '@voltras/node-sdk';
 * import { useVoltraScanner, useVoltraDevice } from '@voltras/node-sdk/react';
 *
 * function WorkoutScreen() {
 *   const manager = useMemo(() => new VoltraManager(), []);
 *   const [client, setClient] = useState<VoltraClient | null>(null);
 *
 *   // Scanner state
 *   const { devices, isScanning, scan } = useVoltraScanner(manager);
 *
 *   // Device state (when connected)
 *   const { connectionState, currentFrame, settings } = useVoltraDevice(client);
 *
 *   const handleConnect = async (device: DiscoveredDevice) => {
 *     const connected = await manager.connect(device);
 *     setClient(connected);
 *   };
 *
 *   return (
 *     <View>
 *       <Button onPress={() => scan()}>
 *         {isScanning ? 'Scanning...' : 'Scan'}
 *       </Button>
 *       {devices.map((d) => (
 *         <Button key={d.id} onPress={() => handleConnect(d)}>
 *           {d.name}
 *         </Button>
 *       ))}
 *       {connectionState === 'connected' && (
 *         <Text>Position: {currentFrame?.position}</Text>
 *       )}
 *     </View>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import type { DiscoveredDevice } from '../bluetooth/models/device';
import type { TelemetryFrame } from '../voltra/models/telemetry';
import type { VoltraConnectionState } from '../voltra/models/connection';
import { DEFAULT_SETTINGS } from '../voltra/models/device';
import type { VoltraDeviceSettings, VoltraRecordingState } from '../voltra/models/device';
import type { VoltraManager } from '../sdk/voltra-manager';
import type { VoltraClient } from '../sdk/voltra-client';
import type { ScanOptions } from '../sdk/types';

// =============================================================================
// useVoltraScanner
// =============================================================================

/**
 * Scanner state and controls.
 */
export interface VoltraScannerState {
  /** Devices discovered in the last scan */
  devices: DiscoveredDevice[];
  /** Whether a scan is in progress */
  isScanning: boolean;
  /** Error from the last scan, if any */
  error: Error | null;
  /** Start scanning for devices */
  scan: (options?: ScanOptions) => Promise<DiscoveredDevice[]>;
  /** Clear discovered devices */
  clear: () => void;
}

/**
 * Hook for scanning for Voltra devices.
 *
 * @param manager VoltraManager instance
 * @returns Scanner state and controls
 */
export function useVoltraScanner(manager: VoltraManager | null): VoltraScannerState {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Sync with manager's scan state
  useEffect(() => {
    if (!manager) return;

    const unsubscribe = manager.subscribe((event) => {
      switch (event.type) {
        case 'scanStarted':
          setIsScanning(true);
          setError(null);
          break;
        case 'scanStopped':
          setIsScanning(false);
          setDevices(event.devices);
          break;
      }
    });

    // Sync initial state
    setDevices(manager.devices);
    setIsScanning(manager.isScanning);

    return unsubscribe;
  }, [manager]);

  const scan = useCallback(
    async (options?: ScanOptions): Promise<DiscoveredDevice[]> => {
      if (!manager) {
        const err = new Error('No manager provided');
        setError(err);
        throw err;
      }

      try {
        return await manager.scan(options);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      }
    },
    [manager]
  );

  const clear = useCallback(() => {
    setDevices([]);
    setError(null);
  }, []);

  return { devices, isScanning, error, scan, clear };
}

// =============================================================================
// useVoltraDevice
// =============================================================================

/**
 * Device state.
 */
export interface VoltraDeviceState {
  /** Current connection state */
  connectionState: VoltraConnectionState;
  /** Whether connected */
  isConnected: boolean;
  /** Current recording state */
  recordingState: VoltraRecordingState;
  /** Whether recording is active */
  isRecording: boolean;
  /** Current device settings */
  settings: VoltraDeviceSettings;
  /** Most recent telemetry frame */
  currentFrame: TelemetryFrame | null;
  /** Last error, if any */
  error: Error | null;
}

const DEFAULT_STATE: VoltraDeviceState = {
  connectionState: 'disconnected',
  isConnected: false,
  recordingState: 'idle',
  isRecording: false,
  settings: DEFAULT_SETTINGS,
  currentFrame: null,
  error: null,
};

/**
 * Hook for observing a Voltra device's state.
 *
 * @param client VoltraClient instance (or null if not connected)
 * @returns Device state
 */
export function useVoltraDevice(client: VoltraClient | null): VoltraDeviceState {
  const [state, setState] = useState<VoltraDeviceState>(DEFAULT_STATE);

  useEffect(() => {
    if (!client) {
      setState(DEFAULT_STATE);
      return;
    }

    // Initial state from client
    setState({
      connectionState: client.connectionState,
      isConnected: client.isConnected,
      recordingState: client.recordingState,
      isRecording: client.isRecording,
      settings: client.settings,
      currentFrame: null,
      error: client.error,
    });

    // Subscribe to client events
    const unsubscribe = client.subscribe((event) => {
      switch (event.type) {
        case 'connectionStateChanged':
          setState((prev) => ({
            ...prev,
            connectionState: event.state,
            isConnected: event.state === 'connected',
          }));
          break;

        case 'recordingStateChanged':
          setState((prev) => ({
            ...prev,
            recordingState: event.state,
            isRecording: event.state === 'active',
          }));
          break;

        case 'frame':
          setState((prev) => ({ ...prev, currentFrame: event.frame }));
          break;

        case 'error':
          setState((prev) => ({ ...prev, error: event.error }));
          break;

        case 'connected':
          setState((prev) => ({
            ...prev,
            settings: client.settings,
            error: null,
          }));
          break;

        case 'disconnected':
          setState(DEFAULT_STATE);
          break;
      }
    });

    return unsubscribe;
  }, [client]);

  return state;
}

// =============================================================================
// useVoltra (Combined convenience hook)
// =============================================================================

/**
 * Combined state for simple single-device use cases.
 */
export interface UseVoltraState extends VoltraScannerState, VoltraDeviceState {
  /** The connected client, if any */
  client: VoltraClient | null;
  /** Connect to a device */
  connect: (device: DiscoveredDevice) => Promise<VoltraClient>;
  /** Disconnect current device */
  disconnect: () => Promise<void>;
  /** Set weight (shorthand) */
  setWeight: (lbs: number) => Promise<void>;
  /** Set chains (shorthand) */
  setChains: (lbs: number) => Promise<void>;
  /** Set eccentric (shorthand) */
  setEccentric: (percent: number) => Promise<void>;
  /** Start recording (shorthand) */
  startRecording: () => Promise<void>;
  /** Stop recording (shorthand) */
  stopRecording: () => Promise<void>;
}

/**
 * All-in-one hook for simple single-device scenarios.
 * Combines scanner and device state.
 *
 * For multi-device scenarios, use useVoltraScanner and useVoltraDevice separately.
 *
 * @param manager VoltraManager instance
 * @returns Combined state and controls
 */
export function useVoltra(manager: VoltraManager | null): UseVoltraState {
  const [client, setClient] = useState<VoltraClient | null>(null);

  const scanner = useVoltraScanner(manager);
  const device = useVoltraDevice(client);

  // Listen for device connections/disconnections
  useEffect(() => {
    if (!manager) return;

    const unsubConnect = manager.onDeviceConnected((connectedClient) => {
      setClient(connectedClient);
    });

    const unsubDisconnect = manager.onDeviceDisconnected(() => {
      setClient(null);
    });

    return () => {
      unsubConnect();
      unsubDisconnect();
    };
  }, [manager]);

  const connect = useCallback(
    async (deviceToConnect: DiscoveredDevice): Promise<VoltraClient> => {
      if (!manager) throw new Error('No manager provided');
      const connectedClient = await manager.connect(deviceToConnect);
      setClient(connectedClient);
      return connectedClient;
    },
    [manager]
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!client) return;
    await client.disconnect();
    setClient(null);
  }, [client]);

  // Shorthand methods
  const setWeight = useCallback(
    async (lbs: number) => {
      if (!client) throw new Error('Not connected');
      await client.setWeight(lbs);
    },
    [client]
  );

  const setChains = useCallback(
    async (lbs: number) => {
      if (!client) throw new Error('Not connected');
      await client.setChains(lbs);
    },
    [client]
  );

  const setEccentric = useCallback(
    async (percent: number) => {
      if (!client) throw new Error('Not connected');
      await client.setEccentric(percent);
    },
    [client]
  );

  const startRecording = useCallback(async () => {
    if (!client) throw new Error('Not connected');
    await client.startRecording();
  }, [client]);

  const stopRecording = useCallback(async () => {
    if (!client) throw new Error('Not connected');
    await client.stopRecording();
  }, [client]);

  return {
    // Scanner state
    ...scanner,
    // Device state
    ...device,
    // Client reference
    client,
    // Actions
    connect,
    disconnect,
    setWeight,
    setChains,
    setEccentric,
    startRecording,
    stopRecording,
  };
}
