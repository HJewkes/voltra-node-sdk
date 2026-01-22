# React Native Example

Example React Native app demonstrating the Voltra SDK with Expo.

## Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator or Android Emulator (or physical device)
- A Voltra device

## Setup

```bash
npm install
```

## Running

### iOS

```bash
npm run ios
```

### Android

```bash
npm run android
```

### Expo Go

```bash
npm start
```

Then scan the QR code with the Expo Go app.

**Note:** Bluetooth functionality may be limited in Expo Go. For full functionality,
use a development build or run on a physical device.

## Features

- Scan for nearby Voltra devices
- Connect to a device
- Configure weight settings
- Start/stop workout recording
- Real-time telemetry display

## App Structure

```
app/
├── _layout.tsx    # Root layout with navigation
└── index.tsx      # Main workout screen
```

## Platform Notes

### iOS

- Requires iOS 13.0 or later
- Add NSBluetoothAlwaysUsageDescription to Info.plist (done automatically by react-native-ble-plx)

### Android

- Requires Android 5.0 (API 21) or later
- Requires location permission for BLE scanning
- The app will request permissions automatically

## Troubleshooting

**"Bluetooth is not available":**
- On iOS Simulator, Bluetooth is not supported - use a physical device
- On Android Emulator, enable Bluetooth in emulator settings

**Permission denied:**
- Make sure you've granted Bluetooth and Location permissions
- On Android 12+, check for BLUETOOTH_SCAN and BLUETOOTH_CONNECT permissions
