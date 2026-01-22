# Getting Started: React Native

This guide walks you through running the React Native (Expo) example from scratch.

## Prerequisites

### 1. Install Node.js

Download and install Node.js 18 or later from [nodejs.org](https://nodejs.org/).

```bash
node --version  # Should show v18.x.x or higher
npm --version   # Should show 9.x.x or higher
```

### 2. Install Expo CLI

```bash
npm install -g expo-cli
```

Or use npx (no global install needed):
```bash
npx expo --version
```

### 3. Mobile Device or Emulator

**Physical Device (Recommended)**:
- Install **Expo Go** app from App Store (iOS) or Play Store (Android)
- Device must have Bluetooth capability
- iOS Simulator does NOT support Bluetooth

**Android Emulator**:
- Some Android emulators support Bluetooth passthrough
- Physical device is more reliable

### 4. Voltra Device

- Power on your Voltra device
- Ensure it's not connected to another app

---

## Setup

### 1. Clone or Download the SDK

```bash
git clone https://github.com/voltra/node-sdk.git
cd node-sdk
```

### 2. Install SDK Dependencies

```bash
npm install
```

### 3. Build the SDK

```bash
npm run build
```

### 4. Navigate to React Native Example

```bash
cd examples/react-native
```

### 5. Install Example Dependencies

```bash
npm install
```

This installs:
- `expo` - React Native framework
- `expo-router` - File-based routing
- `react-native-ble-plx` - Bluetooth library
- `@voltras/node-sdk` - Links to the parent SDK

---

## iOS Setup (Additional Steps)

### 1. Install iOS Dependencies

```bash
npx pod-install
# or
cd ios && pod install && cd ..
```

### 2. Configure Bluetooth Permissions

The example's `app.json` already includes the required iOS permissions. If creating your own app, add to `app.json`:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSBluetoothAlwaysUsageDescription": "Required to connect to your Voltra device",
        "NSBluetoothPeripheralUsageDescription": "Required to connect to your Voltra device"
      }
    }
  }
}
```

---

## Android Setup (Additional Steps)

### 1. Configure Permissions

The example's `app.json` already includes required permissions. For your own app, add:

```json
{
  "expo": {
    "android": {
      "permissions": [
        "android.permission.BLUETOOTH",
        "android.permission.BLUETOOTH_ADMIN",
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.ACCESS_FINE_LOCATION"
      ]
    }
  }
}
```

### 2. Enable Location Services

Android requires Location Services to be enabled for Bluetooth scanning (this is a platform requirement, not something we can change).

---

## Running the Example

### Option 1: Expo Go (Quickest)

```bash
npm start
```

This shows a QR code. Scan it with:
- **iOS**: Camera app → tap the notification
- **Android**: Expo Go app → Scan QR code

**Note**: Expo Go has limitations. For full Bluetooth support, use a development build.

### Option 2: Development Build (Recommended)

For reliable Bluetooth support, create a development build:

```bash
# iOS
npx expo run:ios --device

# Android
npx expo run:android --device
```

This builds and installs the app directly on your connected device.

---

## Using the Demo App

1. **Launch the app** on your device
2. **Tap "Scan for Devices"** - Requests Bluetooth permission if needed
3. **Wait for scan** - Nearby Voltra devices appear in the list
4. **Tap a device** to connect
5. **Select weight** using the buttons (25, 50, 75, 100 lbs)
6. **Tap "Start"** to begin recording
7. **Move the Voltra** - Watch metrics update in real-time
8. **Tap "Stop"** when done
9. **Tap "Disconnect"** to release the device

---

## Understanding the Code

The example uses the SDK's React hooks:

```typescript
import { VoltraManager } from '@voltras/node-sdk';
import { useVoltraScanner, useVoltraDevice } from '@voltras/node-sdk/react';

function App() {
  // Create manager for native platform
  const manager = useMemo(() => VoltraManager.forNative(), []);
  
  // Scanner hook - devices, scanning state, scan function
  const { devices, isScanning, scan } = useVoltraScanner(manager);
  
  // Device hook - connection state, current frame, settings
  const { connectionState, currentFrame, isRecording } = useVoltraDevice(client);
  
  // ...
}
```

---

## Troubleshooting

### "Bluetooth permission denied"

**iOS**: 
- Go to Settings → Privacy → Bluetooth → Enable for your app
- Or reinstall the app to re-trigger the permission prompt

**Android**:
- Go to Settings → Apps → Your App → Permissions → Enable Bluetooth and Location
- Ensure Location Services are ON (required for BLE scanning)

### Scan returns no devices

1. Is the Voltra powered on?
2. Is it connected to Beyond+ or another app? Disconnect first
3. Is Bluetooth enabled on your device?
4. (Android) Is Location Services enabled?
5. Are you within range (~10 meters)?

### App crashes on launch

- Ensure you're using a development build, not Expo Go
- Check that `react-native-ble-plx` is properly installed
- Run `npx pod-install` for iOS

### "BleManager not found" error

The `react-native-ble-plx` library requires native code. You cannot use Expo Go for full functionality - create a development build instead.

### iOS Simulator doesn't find devices

iOS Simulator does not support Bluetooth. You must test on a physical iOS device.

### Android emulator doesn't find devices

Most Android emulators don't support Bluetooth passthrough. Use a physical Android device.

---

## Building for Production

### iOS

```bash
npx expo build:ios
# or
eas build --platform ios
```

### Android

```bash
npx expo build:android
# or
eas build --platform android
```

---

## Next Steps

- Review `app/index.tsx` to understand the full implementation
- Explore the SDK's React hooks in `src/react/hooks.ts`
- Check `docs/concepts/platform-adapters.md` for native adapter details
- See `docs/troubleshooting.md` for common issues
