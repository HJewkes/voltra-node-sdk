/**
 * Stub type declarations for react-native-ble-plx
 *
 * This is a peer dependency - these types are for SDK development only.
 * Users of the SDK should install react-native-ble-plx themselves.
 */

declare module 'react-native-ble-plx' {
  export interface Device {
    id: string;
    name: string | null;
    localName: string | null;
    rssi: number | null;
    isConnected(): Promise<boolean>;
    discoverAllServicesAndCharacteristics(): Promise<Device>;
    requestMTU(mtu: number): Promise<Device>;
    writeCharacteristicWithResponseForService(
      serviceUUID: string,
      characteristicUUID: string,
      valueBase64: string
    ): Promise<void>;
    monitorCharacteristicForService(
      serviceUUID: string,
      characteristicUUID: string,
      callback: (error: Error | null, characteristic: { value: string | null } | null) => void
    ): { remove: () => void };
    onDisconnected(callback: (error: Error | null, device: Device) => void): { remove: () => void };
    cancelConnection(): Promise<Device>;
  }

  export enum State {
    Unknown = 'Unknown',
    Resetting = 'Resetting',
    Unsupported = 'Unsupported',
    Unauthorized = 'Unauthorized',
    PoweredOff = 'PoweredOff',
    PoweredOn = 'PoweredOn',
  }

  export interface BleManagerOptions {
    restoreStateIdentifier?: string;
    restoreStateFunction?: (restoredState: { connectedPeripherals: Device[] } | null) => void;
  }

  export interface ScanOptions {
    allowDuplicates?: boolean;
    scanMode?: number;
    callbackType?: number;
  }

  export class BleManager {
    constructor(options?: BleManagerOptions);
    destroy(): void;
    onStateChange(
      callback: (state: State) => void,
      emitCurrentState?: boolean
    ): { remove: () => void };
    startDeviceScan(
      serviceUUIDs: string[] | null,
      options: ScanOptions | null,
      callback: (error: Error | null, device: Device | null) => void
    ): void;
    stopDeviceScan(): void;
    connectToDevice(deviceId: string, options?: { autoConnect?: boolean }): Promise<Device>;
  }
}
