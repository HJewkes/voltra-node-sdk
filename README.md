# @voltras/node-sdk

SDK for connecting to and controlling Voltra fitness devices.

[![npm version](https://img.shields.io/npm/v/@voltras/node-sdk.svg)](https://www.npmjs.com/package/@voltras/node-sdk)
[![CI](https://github.com/voltra/node-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/voltra/node-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Simple API**: `VoltraManager` handles discovery, returns `VoltraClient` for device control
- **Cross-platform**: Web browsers, Node.js, and React Native
- **Multi-device**: Connect to multiple devices simultaneously
- **React hooks**: Clean `useVoltraScanner` and `useVoltraDevice` hooks
- **TypeScript**: Full type definitions included
- **Real-time telemetry**: Stream position, velocity, and force data

## Installation

```bash
npm install @voltras/node-sdk
```

### Platform dependencies

| Platform | Additional Install |
|----------|-------------------|
| React Native | `npm install react-native-ble-plx` |
| Node.js | `npm install webbluetooth` |
| Web browsers | None (uses Web Bluetooth API) |

## Quick Start

### Web / Node.js

```typescript
import { VoltraManager } from '@voltras/node-sdk';

// Create manager (auto-detects platform)
const manager = new VoltraManager();

// Scan and connect to first device
const client = await manager.connectFirst();

// Or connect by name
const client = await manager.connectByName('VTR-123456');

// Control the device
await client.setWeight(50);

client.onFrame((frame) => {
  console.log('Position:', frame.position, 'Velocity:', frame.velocity);
});

await client.startRecording();
// ... workout ...
await client.stopRecording();

// Cleanup
manager.dispose();
```

### React Native

```typescript
import { VoltraManager } from '@voltras/node-sdk';

// Specify native platform
const manager = VoltraManager.forNative();
// or: new VoltraManager({ platform: 'native' })

// Rest of the API is identical
const client = await manager.connectFirst();
```

### React Hooks

```tsx
import { VoltraManager } from '@voltras/node-sdk';
import { useVoltraScanner, useVoltraDevice } from '@voltras/node-sdk/react';

function WorkoutScreen() {
  const manager = useMemo(() => VoltraManager.forNative(), []);
  const [client, setClient] = useState<VoltraClient | null>(null);

  // Scanner state
  const { devices, isScanning, scan } = useVoltraScanner(manager);

  // Device state
  const { connectionState, currentFrame, isRecording } = useVoltraDevice(client);

  const handleConnect = async (device: DiscoveredDevice) => {
    const connected = await manager.connect(device);
    setClient(connected);
  };

  return (
    <View>
      <Button onPress={() => scan()}>
        {isScanning ? 'Scanning...' : 'Scan'}
      </Button>

      {devices.map((device) => (
        <Button key={device.id} onPress={() => handleConnect(device)}>
          {device.name}
        </Button>
      ))}

      {connectionState === 'connected' && (
        <Text>Position: {currentFrame?.position}</Text>
      )}
    </View>
  );
}
```

## Multi-Device

```typescript
const manager = new VoltraManager();

// Listen for device events
manager.onDeviceConnected((client, deviceId, deviceName) => {
  console.log('Connected:', deviceName);
  client.onFrame((frame) => console.log(`[${deviceName}]`, frame.position));
});

// Connect to multiple devices
const devices = await manager.scan();
await manager.connect(devices[0]);
await manager.connect(devices[1]);

// Access individual clients
const client = manager.getClient(devices[0].id);
await client?.setWeight(50);

// Or get all clients
for (const client of manager.getAllClients()) {
  await client.startRecording();
}
```

## API Reference

### VoltraManager

Main entry point for the SDK.

```typescript
const manager = new VoltraManager(options?);
// or
const manager = VoltraManager.forWeb();
const manager = VoltraManager.forNode();
const manager = VoltraManager.forNative();
```

**Methods:**
- `scan(options?)` - Scan for Voltra devices
- `connect(device)` - Connect and return a VoltraClient
- `connectFirst(options?)` - Connect to first available device
- `connectByName(name, options?)` - Scan + connect by device name
- `getClient(deviceId)` - Get connected client by ID
- `getAllClients()` - Get all connected clients
- `disconnect(deviceId)` - Disconnect specific device
- `disconnectAll()` - Disconnect all devices
- `dispose()` - Clean up resources

### VoltraClient

Controls a single connected device.

**Methods:**
- `setWeight(lbs)` - Set weight (5-200 in increments of 5)
- `setChains(lbs)` - Set chains (0-100)
- `setEccentric(percent)` - Set eccentric adjustment (-195 to +195)
- `startRecording()` - Start recording
- `stopRecording()` - Stop recording
- `onFrame(callback)` - Subscribe to telemetry frames
- `disconnect()` - Disconnect from device

**Properties:**
- `connectionState` - 'disconnected' | 'connecting' | 'authenticating' | 'connected'
- `isConnected` - Whether connected
- `settings` - Current device settings
- `recordingState` - 'idle' | 'preparing' | 'ready' | 'active' | 'stopping'
- `isRecording` - Whether recording

### TelemetryFrame

```typescript
interface TelemetryFrame {
  sequence: number;   // Packet sequence number
  timestamp: number;  // Unix ms when received
  phase: number;      // Movement phase (see MovementPhase)
  position: number;   // Position (0-600 raw)
  velocity: number;   // Velocity (raw value)
  force: number;      // Force (signed value)
}
```

### React Hooks

```typescript
import { useVoltraScanner, useVoltraDevice } from '@voltras/node-sdk/react';

// Scanner state
const { devices, isScanning, scan, error, clear } = useVoltraScanner(manager);

// Device state
const {
  connectionState,
  isConnected,
  recordingState,
  isRecording,
  currentFrame,
  settings,
  error,
} = useVoltraDevice(client);
```

## Error Handling

```typescript
import {
  VoltraSDKError,
  ConnectionError,
  AuthenticationError,
  NotConnectedError,
} from '@voltras/node-sdk';

try {
  await manager.connectByName('VTR-123');
} catch (error) {
  if (error instanceof ConnectionError) {
    console.log('Connection failed:', error.code);
  }
}
```

## Examples

See the [examples](./examples) directory:

- [Node.js](./examples/node) - CLI examples
- [Web Browser](./examples/web) - Interactive demo
- [React Native](./examples/react-native) - Expo app

## Documentation

### Getting Started

Step-by-step setup guides for each platform:

- [Node.js](./docs/getting-started/node.md) - Prerequisites, setup, running examples
- [Web Browser](./docs/getting-started/web.md) - Browser requirements, HTTPS, Vite setup
- [React Native](./docs/getting-started/react-native.md) - Expo, permissions, development builds

### Concepts

Technical deep-dives:

- [Bluetooth Protocol](./docs/concepts/bluetooth-protocol.md) - Voltra BLE protocol, commands, telemetry format
- [Platform Adapters](./docs/concepts/platform-adapters.md) - Native vs Web vs Node.js differences

### Other

- [Troubleshooting](./docs/troubleshooting.md) - Common issues and solutions
- [Roadmap](./docs/roadmap/) - Planned features (ReplayBLEAdapter, etc.)

## License

MIT - see [LICENSE](./LICENSE)
