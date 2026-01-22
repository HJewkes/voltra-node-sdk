# Platform Adapters

The SDK provides three BLE adapters to support different runtime environments. Each implements the same `BLEAdapter` interface but handles platform-specific Bluetooth APIs.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      BLEAdapter Interface                    │
│  scan() · connect() · disconnect() · write() · onNotification│
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ NativeBLEAdapter│   │ WebBLEAdapter │     │ NodeBLEAdapter │
│ (React Native) │    │   (Browser)   │     │   (Node.js)   │
└───────────────┘     └───────────────┘     └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│react-native-  │     │ Web Bluetooth │     │  webbluetooth │
│   ble-plx     │     │     API       │     │    (npm)      │
└───────────────┘     └───────────────┘     └───────────────┘
```

## Platform Comparison

| Feature | Native (iOS/Android) | Web Browser | Node.js |
|---------|---------------------|-------------|---------|
| **Dependency** | `react-native-ble-plx` | None (built-in) | `webbluetooth` |
| **Device Selection** | Returns device list | Browser picker UI | Programmatic callback |
| **Scan Timeout** | Configurable | Browser-controlled | Configurable |
| **Background Mode** | Supported (with config) | No | Yes |
| **Auto-reconnect** | Built-in | No | No |

## Native Adapter (React Native)

For iOS and Android apps using React Native.

### Setup

```bash
npm install react-native-ble-plx
```

iOS requires `Info.plist` entries:
```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Required to connect to your Voltra device</string>
```

Android requires permissions in `AndroidManifest.xml` and runtime permission requests for Android 12+.

### Device Selection Flow

```typescript
const manager = VoltraManager.forNative();

// Returns all discovered devices
const devices = await manager.scan({ timeout: 10000 });

// App displays list, user selects
await manager.connect(selectedDevice);
```

### Unique Features

- **Auto-reconnect**: Automatically reconnects when app returns from background
- **Android permissions**: Handles runtime permission requests
- **App state monitoring**: Manages BLE state across app lifecycle

---

## Web Adapter (Browser)

For web applications using the Web Bluetooth API.

### Requirements

- **Browser**: Chrome, Edge, or Opera (Safari/Firefox don't support Web Bluetooth)
- **Security**: HTTPS or localhost required
- **User gesture**: Must be triggered by user interaction (click/tap)

### Device Selection Flow

```typescript
const manager = VoltraManager.forWeb();
// or just: new VoltraManager() - auto-detects web environment

// Triggers browser's native device picker
const devices = await manager.scan();

// User selects from browser UI, then:
await manager.connect(devices[0]);
```

### How It Works

1. `scan()` calls `navigator.bluetooth.requestDevice()`
2. Browser shows native device picker dialog
3. User selects device from the picker
4. `scan()` returns with the single selected device
5. `connect()` establishes GATT connection

### Limitations

- **No background scanning**: Browser picker is modal
- **Single device selection**: User picks one device per scan
- **No programmatic device selection**: Must use browser's picker UI

---

## Node.js Adapter

For server-side applications, CLI tools, and testing scripts.

### Setup

```bash
npm install webbluetooth
```

Requires platform-specific Bluetooth support (macOS, Linux with BlueZ, Windows).

### Device Selection Flow

```typescript
const manager = VoltraManager.forNode();
// or just: new VoltraManager() - auto-detects Node environment

// Option 1: Scan and select first device
const client = await manager.connectFirst();

// Option 2: Connect by name
const client = await manager.connectByName('VTR-123456');

// Option 3: Custom selection logic
const devices = await manager.scan({ timeout: 10000 });
const target = devices.find(d => d.name === 'VTR-123456');
await manager.connect(target);
```

### Unique Features

- **Programmatic device selection**: No UI required
- **`connectByName()`**: Convenient for known devices
- **Background operation**: Full control, no browser limitations

### Platform Support

| OS | Bluetooth Stack | Notes |
|----|-----------------|-------|
| macOS | CoreBluetooth | Works out of the box |
| Linux | BlueZ | Requires BlueZ 5.43+ |
| Windows | WinRT | Requires Windows 10+ |

---

## Platform Auto-Detection

`VoltraManager` automatically selects the right adapter:

```typescript
const manager = new VoltraManager();
// Automatically uses:
// - WebBLEAdapter if navigator.bluetooth exists
// - NodeBLEAdapter if process.versions.node exists
// - NativeBLEAdapter otherwise
```

For explicit control:

```typescript
// Explicit platform selection
const manager = VoltraManager.forWeb();
const manager = VoltraManager.forNode();
const manager = VoltraManager.forNative();

// Or via constructor
const manager = new VoltraManager({ platform: 'native' });
```

---

## Custom Adapters

You can provide your own adapter factory for testing or custom scenarios:

```typescript
const manager = new VoltraManager({
  adapterFactory: () => new MyCustomAdapter(),
});
```

This is how the planned `ReplayBLEAdapter` will integrate for testing without hardware.
