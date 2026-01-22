# React Native Example

Mobile fitness app demonstrating all features of the Voltra SDK with Expo and React Native.

## Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli` or use npx)
- **Physical device required** - iOS Simulator and most Android emulators don't support Bluetooth
- A Voltra device (powered on, not connected to another app)

## Setup

From the SDK root directory:

```bash
npm install
npm run build
cd examples/react-native
npm install
```

## Running

### Development Build (Required for Bluetooth)

Bluetooth requires native code, so you need a development build:

```bash
# iOS (requires Mac with Xcode)
npx expo run:ios --device

# Android
npx expo run:android --device
```

### Why Not Expo Go?

Expo Go doesn't include `react-native-ble-plx`. You'll see this error:

```
Error: BleManager not found
```

Use a development build for full Bluetooth functionality.

## Features Demonstrated

### Scanning & Connection
- **Device scanning** - Discover nearby Voltra devices
- **Device list** - Display found devices with names and IDs
- **Connection** - Connect to selected device
- **Status indicators** - Visual feedback for connection states

### Resistance Settings
- **Weight selection** - Choose from preset weight options
- **Real-time updates** - Settings change takes effect immediately
- **Settings display** - Show current weight, chains, and eccentric values

### Workout Recording
- **Start/Stop controls** - Control motor engagement
- **Real-time telemetry** - Live position, velocity, and force metrics
- **React hooks** - Uses `useVoltraScanner` and `useVoltraDevice` hooks

## App Structure

```
app/
├── _layout.tsx    # Root layout with expo-router
└── index.tsx      # Main workout screen with full SDK demo
```

## How the Hooks Work

### useVoltraScanner

Manages device discovery:

```typescript
const { devices, isScanning, scan, error, clear } = useVoltraScanner(manager);
```

| Property | Type | Description |
|----------|------|-------------|
| `devices` | `DiscoveredDevice[]` | Found devices |
| `isScanning` | `boolean` | Scan in progress |
| `scan` | `(options?) => Promise<void>` | Start scanning |
| `error` | `Error \| null` | Last scan error |
| `clear` | `() => void` | Clear device list |

### useVoltraDevice

Tracks connected device state:

```typescript
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

| Property | Type | Description |
|----------|------|-------------|
| `connectionState` | `string` | 'disconnected' \| 'connecting' \| 'connected' |
| `isConnected` | `boolean` | Whether connected |
| `recordingState` | `string` | 'idle' \| 'preparing' \| 'active' |
| `isRecording` | `boolean` | Whether recording |
| `currentFrame` | `TelemetryFrame \| null` | Latest telemetry |
| `settings` | `object \| null` | Current device settings |

## Platform Notes

### iOS

- Requires iOS 13.0 or later
- Physical device required (Simulator doesn't support Bluetooth)
- Bluetooth permission prompt shown automatically
- Settings → Privacy → Bluetooth to re-enable if denied

### Android

- Requires Android 5.0 (API 21) or later
- Location Services must be enabled for BLE scanning
- Requires these permissions:
  - `BLUETOOTH_SCAN`
  - `BLUETOOTH_CONNECT`
  - `ACCESS_FINE_LOCATION`

## Troubleshooting

**"BleManager not found":**
- You're running in Expo Go - create a development build instead

**Scan returns no devices:**
1. Is Bluetooth enabled on your phone?
2. (Android) Is Location Services enabled?
3. Is the Voltra powered on?
4. Is it connected to Beyond+ or another app?
5. Try increasing scan timeout

**iOS Simulator doesn't find devices:**
- iOS Simulator doesn't support Bluetooth - use a physical iPhone

**Permission denied:**
- iOS: Settings → Privacy → Bluetooth → Enable for your app
- Android: Settings → Apps → Your App → Permissions → Enable all

**Connection drops:**
- Check Bluetooth signal strength
- Try moving closer to the device
- Enable auto-reconnect in manager options

## Building for Production

### iOS

```bash
eas build --platform ios
```

### Android

```bash
eas build --platform android
```
