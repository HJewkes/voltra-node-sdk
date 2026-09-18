# @voltras/node-sdk

SDK for connecting to and controlling Voltra fitness devices.

[![npm version](https://img.shields.io/npm/v/@voltras/node-sdk.svg)](https://www.npmjs.com/package/@voltras/node-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What's new in 0.6.0

- **Typed vendor-frame events**: `onPerRep`, `onSummary`, `onSetSummary`,
  `onInProgress` replace the payload-less `onRepBoundary` / `onSetBoundary`
  callbacks (which were removed). Each fires with a structured event payload.
- **Mode-config setters**: `setDamperLevel`, `setAssistMode`,
  `setBandMaxForce`, `setIsokineticTargetSpeed`, `setIsokineticEccMode`,
  `setIsokineticEccSpeedLimit`, `setIsokineticEccConstWeight`,
  `setIsokineticEccOverloadWeight`. `damperLevel` is reflected in
  `client.settings`.
- **`@experimental` QoL setters**: `setTelemetryRate`, `setTelemetrySubscribe`,
  `setCableTrigger`, `setResistanceExperience`. Validated at the protocol
  level but not yet on-device.
- **Breaking changes**: see [MIGRATION.md](./MIGRATION.md#migrating-from-05x-to-060).

## Features

- **Device Control**: Configure weight (5-200 lbs, any integer), chains (0-100 lbs), inverse chains (0-100), and eccentric overload (-195 to +195 lbs)
- **Real-time Telemetry**: Stream position, velocity, and force data during workouts
- **Device Notifications**: Rep/set boundaries, mode confirmations, settings updates, battery level
- **Recording Lifecycle**: Stage, start, and stop recording, with the motor state the device reported
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
await client.setChains(25);         // 0-100 lbs added as you extend
await client.setInverseChains(15);  // 0-100 (see Inverse Chains below)
await client.setEccentric(10);      // -195 to +195 lbs on the eccentric

// 5. Subscribe to real-time telemetry
client.onFrame((frame: TelemetryFrame) => {
  console.log(`Position: ${frame.position}, Velocity: ${frame.velocity}, Force: ${frame.force}`);
});

// 6. Start recording (engages motor)
await client.startRecording();

// ... user performs workout ...

// 7. Stop recording (asks the device to release the cable)
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

Control the device's resistance in four ways:

| Setting | Range | Description |
|---------|-------|-------------|
| **Weight** | 5-200 lbs | Primary resistance (any integer value) |
| **Chains** | 0-100 lbs | Adds load as you extend, the way a lifting chain does as it leaves the floor |
| **Inverse Chains** | 0-100 | Sheds load as you extend. **Under review** - see below |
| **Eccentric** | -195 to +195 lbs | Overload added to (or taken off) the eccentric phase, on top of the weight |

```typescript
// Set all resistance parameters
await client.setWeight(75);          // 75 lbs primary resistance
await client.setChains(20);          // up to 20 lbs added at full extension
await client.setInverseChains(10);   // see "Inverse chains" below
await client.setEccentric(-25);      // 25 lbs LESS on the eccentric than the concentric

// Get available values for each setting
const weights = client.getAvailableWeights();            // [5, 6, 7, ..., 200]
const chains = client.getAvailableChains();              // [0, 1, 2, ..., 100]
const inverseChains = client.getAvailableInverseChains(); // [0, 1, 2, ..., 100]
const eccentric = client.getAvailableEccentric();         // [-195, -194, ..., 195]
```

`setEccentric` takes **signed pounds, not a percentage.** `setEccentric(-25)`
against a 75 lb setting means 50 lb on the way down, not 25% of 75. The
parameter was once named `percent`, which is where the misreading comes from.

#### Inverse chains

**Under review.** `setInverseChains(lbs)` accepts 0-100 today, and
`client.settings.inverseChains` reports what you last asked for. Whether the
device reads that number as an amount of load or as a choice between a few
fixed behaviours is being re-checked against the hardware, so treat anything
other than 0 as "on" rather than as a calibrated weight until that lands.
Tracked as VW-407.

### Requested vs confirmed settings

A setter resolving means the write reached the device, not that the device
adopted it. Three views separate those:

| Property | What it holds |
|----------|---------------|
| `settings` | Last-known values. Survives a reconnect; the one to render |
| `requestedSettings` | Written and not yet echoed back by the device |
| `confirmedSettings` | Reported by the device on the current connection |

```typescript
await client.setWeight(75);
client.requestedSettings.weight;  // 75 - asked for
client.confirmedSettings.weight;  // undefined - the device has not said so yet

// Once the device reports it, the value moves across:
client.confirmedSettings.weight;  // 75
client.requestedSettings.weight;  // undefined - no longer outstanding
```

Both views reset on disconnect, so a value in `confirmedSettings` always came
from the connection you are on. Subscribe to `onSettingsUpdate` to be told when
one moves across.

### Connection and motor state

`connect()` does not resolve when the writes land. It enters
`'awaitingAcceptance'` and resolves only once the device reports that it
accepted the connection, then reads device state back once. Control writes are
refused while that is pending, and `client.hasConfirmedState` says whether the
read has been answered. Anything switching exhaustively on `connectionState`
needs a case for `'awaitingAcceptance'`.

`client.motorState` is what the device last said about the cable motor:
`'engaged'` and `'unloaded'` are reports, `'pending'` means a motor command is
written and unanswered, and `'unknown'` means we do not know - including after
a failed write and on every fresh connection.

### Recording Lifecycle

```typescript
// Option 1: Simple start/stop (stages the device if needed)
await client.startRecording();  // Stages then starts
// ... workout ...
await client.stopRecording();   // Asks the device to release (state: 'idle')

// Option 2: Stage ahead of time for lower latency between sets
await client.prepareRecording();  // Stages the device (state: 'ready')
await client.startRecording();    // Instant start, engages the motor (state: 'active')
await client.endSet();            // Release but stay staged (state: 'ready')
await client.startRecording();    // Next set instant start
await client.stopRecording();     // Release and stand down (state: 'idle')

// Monitor recording state
console.log(client.recordingState);  // 'idle' | 'preparing' | 'ready' | 'active' | 'stopping'
console.log(client.isRecording);     // true when state === 'active'
console.log(client.motorState);      // what the device last reported
```

`prepareRecording()` **stages the device; it does not engage the motor.** The
motor engages on `startRecording()`. Staging ahead of time is what makes the
next `startRecording()` a single write instead of a write plus a settling
delay.

`stopRecording()` and `endSet()` send the device the same release. They differ
only in the recording state the client aims for afterwards (`'idle'` versus
`'ready'`); neither exits a separate device-side "workout mode".

A stop counts as a stop only once the device confirms the release. Without that
report `recordingState` stays `'stopping'` and `motorState` is `'unknown'`,
which is retryable rather than a false all-clear. A failed write throws instead
of being swallowed.

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

    // Typed vendor-frame events (0.6.0+)
    case 'perRep':
      // Fires twice per rep — pull start (event.event.phase === 'pull')
      // and return start (event.event.phase === 'return')
      console.log('Per-rep frame:', event.event);
      break;
    case 'inProgress':
      // ~1 Hz heartbeat with peak/current force, velocity, target weight
      console.log('In-progress beat:', event.event);
      break;
    case 'summary':
      // Fires once at end-of-set
      console.log('Set complete:', event.event);
      break;
    case 'preSummary':
      // Fires ~3s before the final rep
      console.log('Pre-summary:', event.event);
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

// Per-rep events (typed payload, fires twice per rep)
const unsubPerRep = client.onPerRep((event) => {
  // event.phase: 'pull' | 'return'
  // event.repCount, event.setCounter, event.targetWeightTenths
  if (event.phase === 'pull') {
    repCount++;
    playRepSound();
  }
});

// End-of-set summary (typed payload)
const unsubSummary = client.onSummary((event) => {
  // event.schemaVersion, event.setCounter, event.repCount, event.raw
  logSetComplete(event.repCount);
});

// In-progress heartbeat (~1 Hz, typed payload — use sparingly).
// Every field is a per-rep mean the device repeats until the next rep.
const unsubInProgress = client.onInProgress((event) => {
  // event.meanPullForceTenths, event.meanReturnForceTenths,
  // event.meanReturnSpeedMmPerSec, event.pullVolumeRawTenths
  updateForceGauge(event.meanPullForceTenths);
});

// Per-set summary (renamed from onPreSummary in 0.9.0)
const unsubSetSummary = client.onSetSummary((event) => {
  // event.repDurationMs, event.repCount, event.targetWeightTenths
  showSetSummary(event.repDurationMs);
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
unsubPerRep();
// ... etc
```

### Mode-config setters (0.6.0)

Beyond the four core resistance settings, 0.6.0 adds setters for the
remaining mode-specific knobs the device exposes. All persist globally and
resolve on the BLE write completing — they don't wait for a device echo.

```typescript
await client.setDamperLevel(5); // Damper mode (UI shows N+1 → "6")
await client.setAssistMode('on'); // Assist on/off
await client.setBandMaxForce(40); // Resistance band max force (15-70 lbs)
await client.setIsokineticTargetSpeed(1500); // 1500 mm/s = 1.5 m/s
await client.setIsokineticEccMode('isokinetic');
await client.setIsokineticEccSpeedLimit(0); // 0 = auto
await client.setIsokineticEccConstWeight(50);
await client.setIsokineticEccOverloadWeight(75);

// damperLevel is reflected back from the device's settingsUpdate
// notifications and surfaced on client.settings:
console.log(client.settings.damperLevel); // 5

// @experimental — register-validated only
await client.setTelemetryRate(10);
await client.setTelemetrySubscribe('all');
await client.setCableTrigger('open');
await client.setResistanceExperience('intense');
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
// Create with auto-detection (Node resolves to the noble backend)
const manager = new VoltraManager();

// Or specify platform
const manager = VoltraManager.forWeb();
const manager = VoltraManager.forNodeNoble(); // recommended for Node
const manager = VoltraManager.forNode();      // legacy webbluetooth backend
const manager = VoltraManager.forNative();
```

`forNode()` cannot enumerate — its `requestDevice` selects the first matching
device and stops scanning — and is not multi-peripheral-safe. Prefer the
noble backend, which auto-detection now selects for you.

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
| `resolvedPlatform` | Platform actually selected, after auto-detection |
| `resolvedDeviceNamePrefix` | Effective name prefix, or `undefined` when unfiltered |

The last two are getters, useful when a scan returns nothing and you need to
know what the SDK actually chose:

```typescript
console.log(manager.resolvedPlatform, manager.resolvedDeviceNamePrefix);
```

See `examples/node/scan-diagnostics.ts` for a ready-made version that also
prints everything the backend discovered.

Devices are identified by BLE service UUID, so scanning finds every Voltra
regardless of its advertised name (including one renamed from the vendor
app). Name-prefix filtering is opt-in — pass `deviceNamePrefix` to the
constructor or to `scan()` if you want to additionally restrict results to
names starting with a given string:

```typescript
const manager = new VoltraManager({ deviceNamePrefix: 'VTR-' });
// or per scan:
const devices = await manager.scan({ deviceNamePrefix: 'VTR-' });
```

### VoltraClient

Controls a single connected device.

| Method | Description |
|--------|-------------|
| `setWeight(lbs)` | Set weight (5-200, any integer) |
| `setChains(lbs)` | Set chains (0-100) |
| `setInverseChains(lbs)` | Set inverse chains (0-100); under review, see VW-407 |
| `setEccentric(overloadLbs)` | Set eccentric overload in signed pounds (-195 to +195) |
| `setMode(mode)` | Set training mode |
| `prepareRecording()` | Stage the device for a low-latency start |
| `startRecording()` | Start recording (engages the motor) |
| `stopRecording()` | Ask the device to release, then stand down |
| `endSet()` | Release but stay staged |
| `refreshDeviceState()` | Ask the device to report weight, motor state and mode |
| `subscribe(callback)` | Subscribe to all events |
| `onFrame(callback)` | Subscribe to telemetry frames |
| `onPerRep(callback)` | Subscribe to typed per-rep events (0.6.0+) |
| `onSummary(callback)` | Subscribe to end-of-set summary events (0.6.0+) |
| `onSetSummary(callback)` | Subscribe to per-set summary events (0.9.0+) |
| `onInProgress(callback)` | Subscribe to ~1 Hz in-progress heartbeats (0.6.0+) |
| `onModeConfirmed(callback)` | Subscribe to mode confirmation events |
| `onSettingsUpdate(callback)` | Subscribe to device settings updates |
| `onBatteryUpdate(callback)` | Subscribe to battery level updates |
| `onConnectionStateChange(callback)` | Subscribe to connection state changes |
| `disconnect()` | Disconnect from device |
| `dispose()` | Clean up resources |

| Property | Type | Description |
|----------|------|-------------|
| `connectionState` | string | 'disconnected' \| 'connecting' \| 'authenticating' \| 'awaitingAcceptance' \| 'connected' |
| `isConnected` | boolean | Whether connected |
| `recordingState` | string | 'idle' \| 'preparing' \| 'ready' \| 'active' \| 'stopping' |
| `isRecording` | boolean | Whether recording is active |
| `motorState` | string | 'engaged' \| 'unloaded' \| 'pending' \| 'unknown' - what the device reported |
| `settings` | object | Last-known { weight, chains, inverseChains, eccentric, mode, battery } |
| `requestedSettings` | object | Written and not yet echoed back |
| `confirmedSettings` | object | Reported by the device on this connection |
| `hasConfirmedState` | boolean | Whether the device has answered the state read |
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
