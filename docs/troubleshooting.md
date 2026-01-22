# Troubleshooting

Common issues and solutions when working with the Voltra SDK.

## Connection Issues

### Device not found during scan

**Symptoms**: `scan()` returns empty array or device doesn't appear.

**Causes & Solutions**:

| Cause | Solution |
|-------|----------|
| Device not powered on | Ensure the Voltra is turned on (LED should be visible) |
| Device already connected | Only one connection at a time - disconnect from Beyond+ app or other clients |
| Out of Bluetooth range | Move closer to the device (within ~10 meters) |
| Wrong name filter | Voltra devices start with `VTR-` prefix |
| Scan too short | Increase timeout: `scan({ timeout: 15000 })` |

**Platform-specific**:
- **Web**: Must be triggered by user gesture (click/tap)
- **Android**: Check Bluetooth and Location permissions are granted
- **iOS**: Check Bluetooth permission in Settings

### Connection drops immediately

**Symptoms**: Connects briefly then disconnects within 1-3 seconds.

**Cause**: Authentication didn't complete in time. The Voltra requires a device ID to be written immediately after GATT connection.

**Solution**: This is handled internally by `VoltraClient`. If you're using the low-level adapter directly, ensure you pass `immediateWrite` in connect options:

```typescript
await adapter.connect(deviceId, { immediateWrite: Auth.DEVICE_ID });
```

### "Bluetooth unavailable" error

**Platform-specific solutions**:

| Platform | Solution |
|----------|----------|
| **Web** | Use Chrome/Edge/Opera. Ensure HTTPS or localhost. |
| **iOS** | Enable Bluetooth in Settings. Grant app permission. |
| **Android** | Enable Bluetooth. Grant Location + Bluetooth permissions. |
| **Node.js** | Install `webbluetooth` package. Check OS Bluetooth is enabled. |

### Connection works but drops after a few minutes

**Causes**:
- Device timeout due to inactivity
- App went to background (web/mobile)
- Bluetooth interference

**Solutions**:
- Keep sending commands or start recording to maintain activity
- On React Native, the `NativeBLEAdapter` handles app backgrounding automatically
- Move away from WiFi routers or microwaves (2.4GHz interference)

---

## Telemetry Issues

### No telemetry frames received

**Symptoms**: `onFrame()` callback never fires after connecting.

**Checklist**:
1. Is recording started? Call `client.startRecording()` first
2. Is the callback registered? `client.onFrame((frame) => ...)` returns an unsubscribe function
3. Is the device moving? Telemetry only streams during workout activity

### Telemetry values seem wrong

**Understanding raw values**:

| Field | Range | Notes |
|-------|-------|-------|
| `position` | 0-600 | Raw encoder value, not normalized |
| `velocity` | varies | Raw value, sign indicates direction |
| `force` | signed int16 | Negative during eccentric phase |
| `phase` | 0-3 | See `MovementPhase` enum |

The SDK intentionally exposes raw values. Normalize them for your use case:

```typescript
const normalizedPosition = frame.position / 600;  // 0-1 range
```

### Frames arriving out of order

The `sequence` field in `TelemetryFrame` indicates packet order. Occasional gaps are normal due to Bluetooth packet loss. For critical applications, track sequence numbers:

```typescript
let lastSequence = -1;
client.onFrame((frame) => {
  if (lastSequence >= 0 && frame.sequence !== lastSequence + 1) {
    console.warn(`Missed ${frame.sequence - lastSequence - 1} frames`);
  }
  lastSequence = frame.sequence;
});
```

---

## Platform-Specific Issues

### Web Browser

**"User gesture required"**

Web Bluetooth requires a user interaction (click, tap) to trigger `scan()`:

```typescript
// Wrong - will fail
window.onload = () => manager.scan();

// Correct - triggered by user action
button.onclick = () => manager.scan();
```

**"SecurityError: requestDevice requires HTTPS"**

Web Bluetooth only works on:
- `https://` pages
- `localhost` / `127.0.0.1`
- `file://` (some browsers)

**Browser not supported**

Web Bluetooth is supported in:
- Chrome (desktop & Android)
- Edge
- Opera

Not supported in:
- Safari (any platform)
- Firefox
- iOS browsers (all use WebKit which lacks Web Bluetooth)

### React Native (iOS)

**"CBCentralManager not authorized"**

Add to `Info.plist`:
```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Required to connect to your Voltra device</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>Required to connect to your Voltra device</string>
```

**Device not found on iOS simulator**

iOS Simulator doesn't support Bluetooth. Test on a physical device.

### React Native (Android)

**"Permission denied" on Android 12+**

Android 12 (API 31+) requires new Bluetooth permissions. The `NativeBLEAdapter` requests these automatically, but ensure they're in `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

**Scan returns empty on Android**

Location services must be enabled (even though we're not using location). This is an Android platform requirement for BLE scanning.

### Node.js

**"No compatible Bluetooth adapter found"**

The `webbluetooth` package requires native Bluetooth support:

| OS | Requirements |
|----|--------------|
| macOS | Works out of the box |
| Linux | BlueZ 5.43+ (`sudo apt install bluez`) |
| Windows | Windows 10+ with Bluetooth adapter |

**"Operation not permitted" on Linux**

Run with sudo or configure BlueZ permissions:
```bash
sudo setcap cap_net_raw+eip $(which node)
```

---

## Error Codes

The SDK throws typed errors for common failure modes:

| Error Class | When Thrown |
|-------------|-------------|
| `ConnectionError` | Failed to establish BLE connection |
| `AuthenticationError` | Device rejected authentication |
| `TimeoutError` | Operation exceeded time limit |
| `NotConnectedError` | Attempted operation without connection |
| `InvalidSettingError` | Invalid weight/chains/eccentric value |
| `BluetoothUnavailableError` | Platform doesn't support Bluetooth |
| `CommandError` | Device rejected a command |

Example handling:

```typescript
import { ConnectionError, TimeoutError } from '@voltras/node-sdk';

try {
  await manager.connectByName('VTR-123456');
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Device not found - is it powered on?');
  } else if (error instanceof ConnectionError) {
    console.log('Connection failed:', error.message);
  }
}
```

---

## Getting Help

If you're still stuck:

1. Check the [examples](../examples/) for working code
2. Review the [concepts docs](./concepts/) for technical details
3. Open an issue on GitHub with:
   - Platform (iOS/Android/Web/Node)
   - SDK version
   - Code snippet reproducing the issue
   - Error message or unexpected behavior
