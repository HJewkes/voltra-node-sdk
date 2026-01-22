# @voltra/node-sdk

SDK for connecting to and controlling Voltra fitness devices.

[![npm version](https://img.shields.io/npm/v/@voltra/node-sdk.svg)](https://www.npmjs.com/package/@voltra/node-sdk)
[![CI](https://github.com/voltra/node-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/voltra/node-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Cross-platform**: Works on React Native, Web browsers, and Node.js
- **High-level API**: `VoltraClient` for simplified single-device control
- **Multi-device**: `VoltraManager` for fleet management
- **React hooks**: `useScanner` and `useVoltraClient` for React/React Native apps
- **TypeScript**: Full type definitions included
- **Real-time telemetry**: Stream position, velocity, and force data

## Installation

```bash
npm install @voltra/node-sdk
```

### Platform-specific dependencies

**React Native:**
```bash
npm install react-native-ble-plx
```

**Node.js:**
```bash
npm install webbluetooth
```

**Web browsers:** No additional dependencies needed (uses Web Bluetooth API).

## Quick Start

### React Native

```tsx
import { VoltraClient, NativeBLEAdapter, BLE } from '@voltra/node-sdk';

// Create adapter and client
const adapter = new NativeBLEAdapter({ ble: BLE });
const client = new VoltraClient({ adapter });

// Scan and connect
const devices = await client.scan();
await client.connect(devices[0]);

// Configure device
await client.setWeight(50);  // 50 lbs

// Listen for telemetry
client.onFrame((frame) => {
  console.log('Position:', frame.position, 'Velocity:', frame.velocity);
});

// Start recording (workout)
await client.startRecording();
// ... workout ...
await client.stopRecording();

// Cleanup
await client.disconnect();
client.dispose();
```

### Web Browser

```typescript
import { VoltraClient, WebBLEAdapter, BLE } from '@voltra/node-sdk';

const adapter = new WebBLEAdapter({ ble: BLE });
const client = new VoltraClient({ adapter });

// Note: scan() triggers browser's Bluetooth device picker
const devices = await client.scan();
await client.connect(devices[0]);

// Rest of the API is identical to React Native
await client.setWeight(50);
client.onFrame((frame) => console.log(frame));
```

### Node.js

```typescript
import { VoltraClient, NodeBLEAdapter, BLE } from '@voltra/node-sdk';

const adapter = new NodeBLEAdapter({
  ble: BLE,
  // Optional: auto-select device by name
  deviceChooser: (devices) => devices.find(d => d.name?.includes('VTR')),
});

const client = new VoltraClient({ adapter });

const devices = await client.scan({ timeout: 10000 });
await client.connect(devices[0]);

// Rest of the API is identical
```

## React Hooks

For React and React Native applications:

```tsx
import { useScanner, useVoltraClient } from '@voltra/node-sdk/react';
import { WebBLEAdapter, BLE } from '@voltra/node-sdk';

function WorkoutScreen() {
  const adapter = useMemo(() => new WebBLEAdapter({ ble: BLE }), []);
  
  const { devices, isScanning, scan } = useScanner(adapter);
  const {
    connectionState,
    currentFrame,
    connect,
    disconnect,
    setWeight,
    startRecording,
    stopRecording,
  } = useVoltraClient(adapter);

  return (
    <View>
      <Button onPress={() => scan()} disabled={isScanning}>
        {isScanning ? 'Scanning...' : 'Scan'}
      </Button>
      
      {devices.map((device) => (
        <Button key={device.id} onPress={() => connect(device)}>
          {device.name ?? device.id}
        </Button>
      ))}
      
      {connectionState === 'connected' && (
        <>
          <Text>Position: {currentFrame?.position}</Text>
          <Button onPress={startRecording}>Start</Button>
          <Button onPress={stopRecording}>Stop</Button>
        </>
      )}
    </View>
  );
}
```

## Multi-Device Management

For controlling multiple Voltra devices simultaneously:

```typescript
import { VoltraManager, NativeBLEAdapter, BLE } from '@voltra/node-sdk';

const manager = new VoltraManager({
  adapterFactory: () => new NativeBLEAdapter({ ble: BLE }),
});

// Listen for device events
manager.onDeviceConnected((client, deviceId) => {
  console.log('Connected:', deviceId);
  client.onFrame((frame) => {
    console.log(`[${deviceId}]`, frame.position);
  });
});

manager.onDeviceDisconnected((deviceId) => {
  console.log('Disconnected:', deviceId);
});

// Connect to multiple devices
const devices = await manager.scan();
await manager.connect(devices[0]);
await manager.connect(devices[1]);

// Access individual clients
const client = manager.getClient(devices[0].id);
await client?.setWeight(50);

// Cleanup
manager.dispose();
```

## API Reference

### VoltraClient

Main class for single-device interaction.

```typescript
const client = new VoltraClient(options?: VoltraClientOptions);
```

**Options:**
- `adapter?: BLEAdapter` - BLE adapter to use
- `autoReconnect?: boolean` - Auto-reconnect on disconnect (default: false)
- `maxReconnectAttempts?: number` - Max reconnect attempts (default: 3)
- `reconnectDelayMs?: number` - Delay between attempts (default: 1000)

**Methods:**
- `scan(options?)` - Scan for Voltra devices
- `connect(device)` - Connect to a device
- `disconnect()` - Disconnect from device
- `setWeight(lbs)` - Set weight (5-200 in increments of 5)
- `setChains(lbs)` - Set chains/reverse resistance (0-100)
- `setEccentric(percent)` - Set eccentric adjustment (-195 to +195)
- `prepareRecording()` - Prepare for recording
- `startRecording()` - Start recording (workout)
- `stopRecording()` - Stop recording
- `endSet()` - End current set, stay in workout mode
- `onFrame(callback)` - Subscribe to telemetry frames
- `subscribe(listener)` - Subscribe to all events
- `dispose()` - Clean up resources

**Properties:**
- `connectionState` - Current connection state
- `isConnected` - Whether connected
- `settings` - Current device settings
- `recordingState` - Current recording state
- `isRecording` - Whether recording

### TelemetryFrame

Raw telemetry data from the device:

```typescript
interface TelemetryFrame {
  sequence: number;   // Packet sequence number
  timestamp: number;  // Unix ms when received
  phase: number;      // Movement phase (see MovementPhase)
  position: number;   // Position (0-600 raw range)
  velocity: number;   // Velocity (raw value)
  force: number;      // Force (signed value)
}
```

### Movement Phases

```typescript
import { MovementPhase, PhaseNames } from '@voltra/node-sdk';

// MovementPhase enum values
MovementPhase.CONCENTRIC    // 0 - Lifting phase
MovementPhase.ECCENTRIC     // 1 - Lowering phase
MovementPhase.ISOMETRIC     // 2 - Holding
MovementPhase.AT_BOTTOM     // 3 - At bottom position
MovementPhase.AT_TOP        // 4 - At top position

// Get display name
PhaseNames[MovementPhase.CONCENTRIC]  // "CONCENTRIC"
```

### Error Handling

The SDK provides typed errors for better error handling:

```typescript
import {
  VoltraSDKError,
  ConnectionError,
  AuthenticationError,
  TimeoutError,
  NotConnectedError,
  InvalidSettingError,
  BluetoothUnavailableError,
  CommandError,
  ErrorCode,
} from '@voltra/node-sdk';

try {
  await client.connect(device);
} catch (error) {
  if (error instanceof ConnectionError) {
    console.log('Connection failed:', error.code);
  } else if (error instanceof AuthenticationError) {
    console.log('Auth failed - device may need reset');
  } else if (error instanceof VoltraSDKError) {
    console.log('SDK error:', error.message, error.code);
  }
}
```

## Platform Notes

### React Native

- Requires `react-native-ble-plx` for BLE support
- Handles iOS/Android permission requests automatically
- Background mode requires additional app configuration

### Web Browser

- Uses Web Bluetooth API (Chrome, Edge, Opera)
- `scan()` triggers browser's device picker (user must select device)
- HTTPS required (or localhost for development)

### Node.js

- Requires `webbluetooth` package
- Uses system's Bluetooth adapter
- `deviceChooser` option for programmatic device selection

## Examples

See the [examples](./examples) directory for complete working examples:

- [Node.js](./examples/node) - Basic connection and workout
- [Web Browser](./examples/web) - Browser-based interface
- [React Native](./examples/react-native) - Expo example app

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

MIT - see [LICENSE](./LICENSE) for details.
