# @voltras/node-sdk

SDK for connecting to and controlling Voltra fitness devices.

[![npm version](https://img.shields.io/npm/v/@voltras/node-sdk.svg)](https://www.npmjs.com/package/@voltras/node-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Device Control**: Configure weight (5-200 lbs, any integer), chains (0-100 lbs), inverse chains (0-100 lbs), and eccentric load (-195% to +195%)
- **Real-time Telemetry**: Stream position, velocity, and force data during workouts
- **Device Notifications**: Rep/set boundaries, mode confirmations, settings updates, battery level
- **Recording Lifecycle**: Prepare, start, and stop recording with motor engagement control
- **Cross-platform**: Web browsers, Node.js, and React Native
- **Multi-device**: Connect to and control multiple devices simultaneously
- **React Hooks**: `useVoltraScanner` and `useVoltraDevice` for seamless React integration
- **TypeScript**: Full type definitions included

## Installation

```bash
npm install @voltras/node-sdk
```

### Platform Dependencies

| Platform | Additional Install |
|----------|-------------------|
| Web browsers | None (uses native Bluetooth API) |
| Node.js | `npm install webbluetooth` (polyfill) |
| React Native | `npm install react-native-ble-plx` |

## Quick Start

The typical workflow is: **scan for devices → let user select → connect → configure → workout → disconnect**.

```typescript
import { VoltraManager, type DiscoveredDevice, type TelemetryFrame } from '@voltras/node-sdk';

// 1. Create a manager (auto-detects platform)
const manager = new VoltraManager();

// 2. Scan for devices
const devices = await manager.scan({ timeout: 10000 });
console.log('Found devices:', devices.map(d => d.name));

// 3. Let user select a device (or connect programmatically)
const selectedDevice = devices[0]; // In a real app, user would choose
const client = await manager.connect(selectedDevice);

// 4. Configure resistance settings
await client.setWeight(50);         // 5-200 lbs (any integer)
await client.setChains(25);         // 0-100 lbs (reverse resistance)
await client.setInverseChains(15);  // 0-100 lbs (progressive resistance)
await client.setEccentric(10);      // -195 to +195 (eccentric load %)

// 5. Subscribe to real-time telemetry
client.onFrame((frame: TelemetryFrame) => {
  console.log(`Position: ${frame.position}, Velocity: ${frame.velocity}, Force: ${frame.force}`);
});

// 6. Start recording (engages motor)
await client.startRecording();

// ... user performs workout ...

// 7. Stop recording (disengages motor)
await client.stopRecording();

// 8. Cleanup
await manager.disconnectAll();
manager.dispose();
```

### Convenience Methods

For simpler scenarios, you can skip manual device selection:

```typescript
// Connect to first available device
const client = await manager.connectFirst();

// Connect by device name
const client = await manager.connectByName('VTR-123456');
```

## Core Concepts

### Resistance Settings

Control the device's resistance in three ways:

| Setting | Range | Description |
|---------|-------|-------------|
| **Weight** | 5-200 lbs | Primary resistance (any integer value) |
| **Chains** | 0-100 lbs | Reverse resistance - reduces load as you extend |
| **Inverse Chains** | 0-100 lbs | Progressive resistance - increases load as you extend |
| **Eccentric** | -195% to +195% | Adjusts eccentric (lowering) phase relative to concentric |

```typescript
// Set all resistance parameters
await client.setWeight(75);          // 75 lbs primary resistance
await client.setChains(20);          // 20 lbs chain reduction
await client.setInverseChains(10);   // 10 lbs progressive resistance
await client.setEccentric(-25);      // 25% less resistance on eccentric

// Query current settings
console.log(client.settings);
// { weight: 75, chains: 20, inverseChains: 10, eccentric: -25, mode: 1, battery: 85 }

// Get available values for each setting
const weights = client.getAvailableWeights();            // [5, 6, 7, ..., 200]
const chains = client.getAvailableChains();              // [0, 1, 2, ..., 100]
const inverseChains = client.getAvailableInverseChains(); // [0, 1, 2, ..., 100]
const eccentric = client.getAvailableEccentric();         // [-195, -190, ..., 195]
```

### Recording Lifecycle

Recording controls the motor engagement:

```typescript
// Option 1: Simple start/stop (auto-prepares if needed)
await client.startRecording();  // Prepares then starts
// ... workout ...
await client.stopRecording();   // Stops and disengages motor

// Option 2: Manual prepare for lower latency between sets
await client.prepareRecording();  // Pre-engages motor (state: 'ready')
await client.startRecording();    // Instant start (state: 'active')
await client.endSet();            // End set but stay prepared (state: 'ready')
await client.startRecording();    // Next set instant start
await client.stopRecording();     // Fully disengage (state: 'idle')

// Monitor recording state
console.log(client.recordingState);  // 'idle' | 'preparing' | 'ready' | 'active' | 'stopping'
console.log(client.isRecording);     // true when state === 'active'
```

### Real-time Telemetry

Receive movement data at ~11 Hz when recording:

```typescript
// Subscribe to telemetry frames
const unsubscribe = client.onFrame((frame) => {
  console.log({
    sequence: frame.sequence,   // Packet sequence number
    timestamp: frame.timestamp, // Unix ms when received
    phase: frame.phase,         // MovementPhase enum
    position: frame.position,   // Position in movement (0-600)
    velocity: frame.velocity,   // Current velocity
    force: frame.force,         // Force being applied
  });
});

// Unsubscribe when done
unsubscribe();
```

### Events and Notifications

The SDK provides a comprehensive event system for real-time device notifications:

```typescript
// Subscribe to all events with full type safety
client.subscribe((event) => {
  switch (event.type) {
    // Connection events
    case 'connectionStateChanged':
      console.log('State:', event.state);
      // 'disconnected' | 'connecting' | 'authenticating' | 'connected'
      break;
    case 'connected':
      console.log(`Connected to ${event.deviceName}`);
      break;
    case 'disconnected':
      console.log(`Disconnected from ${event.deviceId}`);
      break;

    // Recording events
    case 'recordingStateChanged':
      console.log('Recording:', event.state);
      break;

    // Telemetry events
    case 'frame':
      console.log('Telemetry:', event.frame);
      break;

    // Workout boundary events (device-detected)
    case 'repBoundary':
      console.log('Rep completed!');
      break;
    case 'setBoundary':
      console.log('Set completed!');
      break;

    // Device notification events
    case 'modeConfirmed':
      console.log('Mode confirmed:', event.mode);
      break;
    case 'settingsUpdate':
      console.log('Device settings:', event.settings);
      break;
    case 'batteryUpdate':
      console.log('Battery:', event.battery, '%');
      break;

    case 'error':
      console.error('Error:', event.error);
      break;
  }
});
```

#### Convenience Subscription Methods

Subscribe to specific event types with dedicated methods:

```typescript
// Telemetry frames (~11 Hz during recording)
const unsubFrame = client.onFrame((frame) => {
  updateUI(frame.position, frame.velocity, frame.force);
});

// Rep boundaries (device detects rep completion)
const unsubRep = client.onRepBoundary(() => {
  repCount++;
  playRepSound();
});

// Set boundaries (device detects set completion)
const unsubSet = client.onSetBoundary(() => {
  logSetComplete();
});

// Mode confirmations (after setMode())
const unsubMode = client.onModeConfirmed((mode) => {
  console.log('Mode now active:', mode);
});

// Settings updates (device reports current state)
const unsubSettings = client.onSettingsUpdate((settings) => {
  // settings: { baseWeight?, chains?, eccentric?, trainingMode? }
  syncUIWithDevice(settings);
});

// Battery level updates
const unsubBattery = client.onBatteryUpdate((battery) => {
  showBatteryIndicator(battery);
});

// Connection state changes
const unsubConnection = client.onConnectionStateChange((state) => {
  updateConnectionUI(state);
});

// Unsubscribe when done
unsubFrame();
unsubRep();
// ... etc
```

## Platform-Specific Setup

### React Native

```typescript
import { VoltraManager } from '@voltras/node-sdk';

// Use forNative() to get React Native BLE support
const manager = VoltraManager.forNative();

// Rest of the API is identical
const devices = await manager.scan();
const client = await manager.connect(devices[0]);
```

### React Hooks

```tsx
import { useMemo, useState } from 'react';
import { VoltraManager, type DiscoveredDevice, type VoltraClient } from '@voltras/node-sdk';
import { useVoltraScanner, useVoltraDevice } from '@voltras/node-sdk/react';

function WorkoutScreen() {
  const manager = useMemo(() => VoltraManager.forNative(), []);
  const [client, setClient] = useState<VoltraClient | null>(null);

  // Scanner hook - manages scan state and discovered devices
  const { devices, isScanning, scan, error: scanError } = useVoltraScanner(manager);

  // Device hook - tracks connection state and telemetry
  const { connectionState, isConnected, isRecording, currentFrame, settings } = useVoltraDevice(client);

  const handleConnect = async (device: DiscoveredDevice) => {
    const connected = await manager.connect(device);
    await connected.setWeight(50);
    setClient(connected);
  };

  return (
    <View>
      {/* Scanning */}
      {!isConnected && (
        <>
          <Button onPress={() => scan({ timeout: 10000 })}>
            {isScanning ? 'Scanning...' : 'Scan for Devices'}
          </Button>
          {devices.map((device) => (
            <Button key={device.id} onPress={() => handleConnect(device)}>
              {device.name}
            </Button>
          ))}
        </>
      )}

      {/* Connected */}
      {isConnected && (
        <>
          <Text>Weight: {settings?.weight} lbs</Text>
          <Text>Position: {currentFrame?.position ?? '--'}</Text>
          <Button onPress={() => client?.startRecording()}>Start</Button>
          <Button onPress={() => client?.stopRecording()}>Stop</Button>
        </>
      )}
    </View>
  );
}
```

## Multi-Device Support

Connect to and control multiple Voltra devices simultaneously:

```typescript
const manager = new VoltraManager();

// Listen for connection events
manager.onDeviceConnected((client, deviceId, deviceName) => {
  console.log(`Connected: ${deviceName}`);
  
  // Configure each device
  client.setWeight(50);
  
  // Handle telemetry per device
  client.onFrame((frame) => {
    console.log(`[${deviceName}] pos=${frame.position}`);
  });
});

manager.onDeviceDisconnected((deviceId) => {
  console.log(`Disconnected: ${deviceId}`);
});

// Scan and connect to multiple devices
const devices = await manager.scan();
for (const device of devices) {
  await manager.connect(device);
}

// Access specific client by ID
const client = manager.getClient(devices[0].id);

// Or iterate all connected clients
for (const client of manager.getAllClients()) {
  await client.startRecording();
}

// Disconnect all when done
await manager.disconnectAll();
```

## Error Handling

```typescript
import {
  VoltraSDKError,
  ConnectionError,
  AuthenticationError,
  NotConnectedError,
  InvalidSettingError,
  CommandError,
  TimeoutError,
} from '@voltras/node-sdk';

try {
  await manager.connect(device);
} catch (error) {
  if (error instanceof ConnectionError) {
    console.log('Connection failed:', error.code, error.message);
  } else if (error instanceof AuthenticationError) {
    console.log('Device authentication failed');
  } else if (error instanceof TimeoutError) {
    console.log('Operation timed out');
  }
}

try {
  await client.setWeight(999); // Invalid weight
} catch (error) {
  if (error instanceof InvalidSettingError) {
    console.log(`Invalid ${error.setting}: ${error.value}`);
    console.log('Available values:', error.validValues);
  }
}
```

## Examples

Complete working examples for each platform:

| Platform | Description | Code |
|----------|-------------|------|
| **Node.js** | CLI app with scanning, settings, and telemetry | [examples/node/](./examples/node) |
| **Web** | Interactive browser demo with UI | [examples/web/](./examples/web) |
| **React Native** | Expo app with hooks | [examples/react-native/](./examples/react-native) |

## API Reference

### VoltraManager

Main entry point - handles device discovery and connection management.

```typescript
// Create with auto-detection
const manager = new VoltraManager();

// Or specify platform
const manager = VoltraManager.forWeb();
const manager = VoltraManager.forNode();
const manager = VoltraManager.forNative();
```

| Method | Description |
|--------|-------------|
| `scan(options?)` | Scan for Voltra devices |
| `connect(device)` | Connect to a device, returns `VoltraClient` |
| `connectFirst(options?)` | Connect to first available device |
| `connectByName(name, options?)` | Scan and connect by device name |
| `getClient(deviceId)` | Get client for connected device |
| `getAllClients()` | Get all connected clients |
| `disconnect(deviceId)` | Disconnect specific device |
| `disconnectAll()` | Disconnect all devices |
| `dispose()` | Clean up all resources |

### VoltraClient

Controls a single connected device.

| Method | Description |
|--------|-------------|
| `setWeight(lbs)` | Set weight (5-200, any integer) |
| `setChains(lbs)` | Set chains (0-100) |
| `setInverseChains(lbs)` | Set inverse chains (0-100) |
| `setEccentric(percent)` | Set eccentric (-195 to +195) |
| `setMode(mode)` | Set training mode |
| `prepareRecording()` | Pre-engage motor for low-latency start |
| `startRecording()` | Start recording (engages motor) |
| `stopRecording()` | Stop recording (disengages motor) |
| `endSet()` | End set but stay prepared |
| `subscribe(callback)` | Subscribe to all events |
| `onFrame(callback)` | Subscribe to telemetry frames |
| `onRepBoundary(callback)` | Subscribe to rep completion events |
| `onSetBoundary(callback)` | Subscribe to set completion events |
| `onModeConfirmed(callback)` | Subscribe to mode confirmation events |
| `onSettingsUpdate(callback)` | Subscribe to device settings updates |
| `onBatteryUpdate(callback)` | Subscribe to battery level updates |
| `onConnectionStateChange(callback)` | Subscribe to connection state changes |
| `disconnect()` | Disconnect from device |
| `dispose()` | Clean up resources |

| Property | Type | Description |
|----------|------|-------------|
| `connectionState` | string | 'disconnected' \| 'connecting' \| 'authenticating' \| 'connected' |
| `isConnected` | boolean | Whether connected |
| `recordingState` | string | 'idle' \| 'preparing' \| 'ready' \| 'active' \| 'stopping' |
| `isRecording` | boolean | Whether recording is active |
| `settings` | object | Current { weight, chains, inverseChains, eccentric, mode, battery } |
| `connectedDeviceId` | string | Connected device ID |
| `connectedDeviceName` | string | Connected device name |

### TelemetryFrame

```typescript
import { MovementPhase } from '@voltras/node-sdk';

interface TelemetryFrame {
  sequence: number;         // Packet sequence number
  timestamp: number;        // Unix ms when received
  phase: MovementPhase;     // Movement phase (see MovementPhase enum)
  position: number;         // Position in movement (0-600)
  velocity: number;         // Current velocity
  force: number;            // Force being applied (signed)
}

// MovementPhase enum values:
// IDLE = 0, CONCENTRIC = 1, HOLD = 2, ECCENTRIC = 3, UNKNOWN = -1
```

## Documentation

### Getting Started Guides

Step-by-step tutorials for using the SDK in your app:

- [Node.js](./docs/getting-started/node.md) - Build a CLI fitness app
- [Web Browser](./docs/getting-started/web.md) - Build a web-based workout tracker
- [React Native](./docs/getting-started/react-native.md) - Build a mobile fitness app

### Technical Deep-Dives

- [Platform Adapters](./docs/concepts/platform-adapters.md) - How adapters work across platforms

### Other

- [Troubleshooting](./docs/troubleshooting.md) - Common issues and solutions
- [Roadmap](./docs/roadmap/) - Planned features

## License

MIT - see [LICENSE](./LICENSE)
