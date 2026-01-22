# Getting Started: React Native

Build mobile fitness apps that connect to Voltra devices using React Native and Expo.

## Prerequisites

### 1. Development Environment

- Node.js 18 or later
- Expo CLI: `npm install -g expo-cli` (or use npx)

### 2. Physical Device Required

**Bluetooth requires a physical device** - simulators don't support BLE:

- iOS: Physical iPhone/iPad (iOS Simulator doesn't support Bluetooth)
- Android: Physical device recommended (some emulators have limited BLE support)

### 3. Voltra Device

- Power on your Voltra device
- Ensure it's not connected to another app

---

## Project Setup

### Option 1: New Expo Project

```bash
npx create-expo-app my-voltra-app --template blank-typescript
cd my-voltra-app
npm install @voltras/node-sdk react-native-ble-plx
```

### Option 2: Existing Project

```bash
npm install @voltras/node-sdk react-native-ble-plx
```

### Configure Permissions

Add to `app.json`:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSBluetoothAlwaysUsageDescription": "Required to connect to your Voltra device",
        "NSBluetoothPeripheralUsageDescription": "Required to connect to your Voltra device"
      }
    },
    "android": {
      "permissions": [
        "android.permission.BLUETOOTH",
        "android.permission.BLUETOOTH_ADMIN",
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.ACCESS_FINE_LOCATION"
      ]
    },
    "plugins": [
      ["react-native-ble-plx", { "isBackgroundEnabled": false }]
    ]
  }
}
```

---

## Your First App

Create `App.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import {
  VoltraManager,
  type DiscoveredDevice,
  type VoltraClient,
} from '@voltras/node-sdk';
import { useVoltraScanner, useVoltraDevice } from '@voltras/node-sdk/react';

export default function App() {
  // Create manager for React Native platform
  const manager = useMemo(() => VoltraManager.forNative(), []);

  // State for selected client
  const [client, setClient] = useState<VoltraClient | null>(null);

  // Scanner hook - handles scanning state and device discovery
  const { devices, isScanning, scan, error: scanError } = useVoltraScanner(manager);

  // Device hook - tracks connection state and telemetry
  const {
    connectionState,
    isConnected,
    isRecording,
    currentFrame,
    settings,
  } = useVoltraDevice(client);

  // Selected weight
  const [selectedWeight, setSelectedWeight] = useState(50);

  // Handlers
  const handleScan = async () => {
    try {
      await scan({ timeout: 10000 });
    } catch (e) {
      Alert.alert('Scan Failed', String(e));
    }
  };

  const handleConnect = async (device: DiscoveredDevice) => {
    try {
      const connected = await manager.connect(device);
      await connected.setWeight(selectedWeight);
      setClient(connected);
    } catch (e) {
      Alert.alert('Connection Failed', String(e));
    }
  };

  const handleDisconnect = async () => {
    await manager.disconnectAll();
    setClient(null);
  };

  const handleWeightChange = async (weight: number) => {
    setSelectedWeight(weight);
    if (client?.isConnected) {
      try {
        await client.setWeight(weight);
      } catch (e) {
        Alert.alert('Error', `Failed to set weight: ${e}`);
      }
    }
  };

  const handleStartRecording = async () => {
    try {
      await client?.startRecording();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  const handleStopRecording = async () => {
    try {
      await client?.stopRecording();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  // Render device item
  const renderDevice = ({ item }: { item: DiscoveredDevice }) => (
    <TouchableOpacity
      style={styles.deviceItem}
      onPress={() => handleConnect(item)}
    >
      <Text style={styles.deviceName}>{item.name ?? 'Unknown'}</Text>
      <Text style={styles.deviceId}>{item.id}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Voltra Workout</Text>

      {/* Connection Status */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              isConnected && styles.statusDotConnected,
              isRecording && styles.statusDotRecording,
            ]}
          />
          <Text style={styles.statusText}>
            {isRecording
              ? 'Recording'
              : connectionState.charAt(0).toUpperCase() + connectionState.slice(1)}
          </Text>
        </View>
        {isConnected && (
          <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
            <Text style={styles.disconnectBtnText}>Disconnect</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Scanner - shown when not connected */}
      {!isConnected && (
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.button, isScanning && styles.buttonDisabled]}
            onPress={handleScan}
            disabled={isScanning}
          >
            <Text style={styles.buttonText}>
              {isScanning ? 'Scanning...' : 'Scan for Devices'}
            </Text>
          </TouchableOpacity>

          {scanError && <Text style={styles.errorText}>{scanError.message}</Text>}

          <FlatList
            data={devices}
            renderItem={renderDevice}
            keyExtractor={(item) => item.id}
            style={styles.deviceList}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {isScanning ? 'Searching...' : 'No devices found'}
              </Text>
            }
          />
        </View>
      )}

      {/* Controls - shown when connected */}
      {isConnected && (
        <>
          {/* Weight Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Weight</Text>
            <View style={styles.weightRow}>
              {[25, 50, 75, 100].map((weight) => (
                <TouchableOpacity
                  key={weight}
                  style={[
                    styles.weightBtn,
                    selectedWeight === weight && styles.weightBtnSelected,
                  ]}
                  onPress={() => handleWeightChange(weight)}
                >
                  <Text
                    style={[
                      styles.weightBtnText,
                      selectedWeight === weight && styles.weightBtnTextSelected,
                    ]}
                  >
                    {weight}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Workout Controls */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Workout</Text>
            <View style={styles.workoutRow}>
              <TouchableOpacity
                style={[styles.startBtn, isRecording && styles.buttonDisabled]}
                onPress={handleStartRecording}
                disabled={isRecording}
              >
                <Text style={styles.buttonText}>Start</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.stopBtn, !isRecording && styles.buttonDisabled]}
                onPress={handleStopRecording}
                disabled={!isRecording}
              >
                <Text style={styles.buttonText}>Stop</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Real-time Metrics */}
          <View style={styles.metricsCard}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {currentFrame?.position.toFixed(0) ?? '--'}
              </Text>
              <Text style={styles.metricLabel}>Position</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {currentFrame?.velocity.toFixed(2) ?? '--'}
              </Text>
              <Text style={styles.metricLabel}>Velocity</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {currentFrame?.force.toFixed(0) ?? '--'}
              </Text>
              <Text style={styles.metricLabel}>Force</Text>
            </View>
          </View>

          {/* Current Settings */}
          <View style={styles.settingsInfo}>
            <Text style={styles.settingsText}>
              Weight: {settings?.weight ?? 0} lbs | 
              Chains: {settings?.chains ?? 0} lbs | 
              Eccentric: {settings?.eccentric ?? 0}%
            </Text>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#4ecdc4',
    marginBottom: 20,
  },
  statusCard: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#666',
    marginRight: 8,
  },
  statusDotConnected: {
    backgroundColor: '#4ecdc4',
  },
  statusDotRecording: {
    backgroundColor: '#ff6b6b',
  },
  statusText: {
    color: '#eee',
    fontSize: 16,
  },
  disconnectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#ff6b6b',
    borderRadius: 6,
  },
  disconnectBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 14,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  button: {
    backgroundColor: '#4ecdc4',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#444',
  },
  buttonText: {
    color: '#1a1a2e',
    fontSize: 16,
    fontWeight: '600',
  },
  deviceList: {
    marginTop: 16,
    maxHeight: 200,
  },
  deviceItem: {
    backgroundColor: '#16213e',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  deviceName: {
    color: '#eee',
    fontSize: 16,
    fontWeight: '600',
  },
  deviceId: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
  emptyText: {
    color: '#666',
    textAlign: 'center',
    marginTop: 16,
  },
  errorText: {
    color: '#ff6b6b',
    marginTop: 8,
  },
  weightRow: {
    flexDirection: 'row',
    gap: 8,
  },
  weightBtn: {
    flex: 1,
    padding: 12,
    backgroundColor: '#16213e',
    borderRadius: 8,
    alignItems: 'center',
  },
  weightBtnSelected: {
    backgroundColor: '#4ecdc4',
  },
  weightBtnText: {
    color: '#eee',
    fontWeight: '600',
    fontSize: 16,
  },
  weightBtnTextSelected: {
    color: '#1a1a2e',
  },
  workoutRow: {
    flexDirection: 'row',
    gap: 8,
  },
  startBtn: {
    flex: 1,
    backgroundColor: '#4ecdc4',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  stopBtn: {
    flex: 1,
    backgroundColor: '#ff6b6b',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  metricsCard: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 20,
    flexDirection: 'row',
    marginBottom: 16,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#4ecdc4',
  },
  metricLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  settingsInfo: {
    alignItems: 'center',
  },
  settingsText: {
    color: '#666',
    fontSize: 12,
  },
});
```

---

## Running the App

### Development Build (Required for BLE)

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

Use a development build instead.

---

## Understanding the Hooks

### useVoltraScanner

Manages device discovery:

```typescript
const { 
  devices,      // DiscoveredDevice[] - found devices
  isScanning,   // boolean - scanning in progress
  scan,         // (options?) => Promise<void> - trigger scan
  error,        // Error | null - last scan error
  clear,        // () => void - clear discovered devices
} = useVoltraScanner(manager);
```

### useVoltraDevice

Tracks connected device state:

```typescript
const {
  connectionState,  // 'disconnected' | 'connecting' | 'authenticating' | 'connected'
  isConnected,      // boolean
  recordingState,   // 'idle' | 'preparing' | 'ready' | 'active' | 'stopping'
  isRecording,      // boolean
  currentFrame,     // TelemetryFrame | null - latest telemetry
  settings,         // { weight, chains, eccentric } | null
  error,            // Error | null
} = useVoltraDevice(client);
```

---

## Advanced Patterns

### Full Settings Control

```tsx
function SettingsPanel({ client }: { client: VoltraClient }) {
  const [weight, setWeight] = useState(50);
  const [chains, setChains] = useState(0);
  const [eccentric, setEccentric] = useState(0);

  const applySettings = async () => {
    await client.setWeight(weight);
    await client.setChains(chains);
    await client.setEccentric(eccentric);
  };

  return (
    <View>
      <Text>Weight: {weight} lbs</Text>
      <Slider
        minimumValue={5}
        maximumValue={200}
        step={5}
        value={weight}
        onSlidingComplete={setWeight}
      />

      <Text>Chains: {chains} lbs</Text>
      <Slider
        minimumValue={0}
        maximumValue={100}
        step={1}
        value={chains}
        onSlidingComplete={setChains}
      />

      <Text>Eccentric: {eccentric}%</Text>
      <Slider
        minimumValue={-195}
        maximumValue={195}
        step={5}
        value={eccentric}
        onSlidingComplete={setEccentric}
      />

      <Button title="Apply" onPress={applySettings} />
    </View>
  );
}
```

### Rep Counter

```tsx
function useRepCounter(client: VoltraClient | null) {
  const [repCount, setRepCount] = useState(0);
  const inRep = useRef(false);

  useEffect(() => {
    if (!client) return;

    const unsubscribe = client.onFrame((frame) => {
      // Detect rep start (high velocity)
      if (!inRep.current && Math.abs(frame.velocity) > 1.0) {
        inRep.current = true;
      }
      
      // Detect rep end (velocity drops)
      if (inRep.current && Math.abs(frame.velocity) < 0.1) {
        inRep.current = false;
        setRepCount((c) => c + 1);
      }
    });

    return unsubscribe;
  }, [client]);

  return { repCount, resetCount: () => setRepCount(0) };
}
```

### Workout Timer

```tsx
function useWorkoutTimer(isRecording: boolean) {
  const [seconds, setSeconds] = useState(0);
  const startTime = useRef<number | null>(null);

  useEffect(() => {
    if (isRecording) {
      startTime.current = Date.now();
      const interval = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startTime.current!) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      startTime.current = null;
      setSeconds(0);
    }
  }, [isRecording]);

  const formatted = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
  return { seconds, formatted };
}
```

---

## Permissions Handling

### iOS

iOS will prompt for Bluetooth permission automatically. If denied, guide users to Settings:

```typescript
import { Linking, Platform } from 'react-native';

async function openSettings() {
  if (Platform.OS === 'ios') {
    await Linking.openURL('app-settings:');
  }
}
```

### Android

Android requires both Bluetooth and Location permissions:

```typescript
import { PermissionsAndroid, Platform } from 'react-native';

async function requestPermissions() {
  if (Platform.OS !== 'android') return true;

  const granted = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);

  return Object.values(granted).every(
    (status) => status === PermissionsAndroid.RESULTS.GRANTED
  );
}
```

---

## Troubleshooting

### "BleManager not found"

You're running in Expo Go. Create a development build instead.

### Scan returns no devices

1. Is Bluetooth enabled on your phone?
2. (Android) Is Location Services enabled?
3. Is the Voltra powered on?
4. Is it connected to Beyond+ or another app?

### iOS Simulator doesn't find devices

iOS Simulator doesn't support Bluetooth. Use a physical iPhone.

### "Bluetooth permission denied"

- iOS: Settings → Privacy → Bluetooth → Enable for your app
- Android: Settings → Apps → Your App → Permissions → Enable Bluetooth and Location

---

## Next Steps

- See the [complete example](../../examples/react-native) with navigation
- Read about [platform adapters](../concepts/platform-adapters.md)
- Check [troubleshooting](../troubleshooting.md) for more solutions
