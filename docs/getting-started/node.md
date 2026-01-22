# Getting Started: Node.js

Build command-line applications that connect to and control Voltra devices.

## Prerequisites

### 1. Node.js 18+

Download from [nodejs.org](https://nodejs.org/) or use a version manager like nvm.

```bash
node --version  # Should show v18.x.x or higher
```

### 2. Bluetooth Hardware

Your computer needs Bluetooth Low Energy (BLE) support:

| OS | Requirements |
|----|--------------|
| **macOS** | Built-in Bluetooth works automatically |
| **Linux** | BlueZ 5.43+: `sudo apt install bluez` |
| **Windows** | Windows 10+ with Bluetooth adapter |

### 3. Voltra Device

- Power on your Voltra device
- Note its name (e.g., `VTR-123456`) - visible on the device or in Beyond+ app
- Ensure it's not connected to another app (only one connection at a time)

---

## Installation

Create a new project and install the SDK:

```bash
mkdir my-voltra-app
cd my-voltra-app
npm init -y
npm install @voltras/node-sdk webbluetooth
npm install -D typescript tsx @types/node
```

Add a script to `package.json`:

```json
{
  "scripts": {
    "start": "tsx src/index.ts"
  }
}
```

---

## Your First App

Create `src/index.ts`:

```typescript
import { VoltraManager, type TelemetryFrame, type DiscoveredDevice } from '@voltras/node-sdk';

async function main() {
  console.log('Voltra SDK - Node.js Tutorial\n');

  // Create manager (auto-detects Node.js platform)
  const manager = new VoltraManager();

  try {
    // 1. Scan for devices
    console.log('Scanning for Voltra devices...');
    const devices = await manager.scan({ timeout: 10000 });

    if (devices.length === 0) {
      console.log('No devices found. Make sure your Voltra is powered on.');
      return;
    }

    // 2. Display found devices
    console.log(`\nFound ${devices.length} device(s):`);
    devices.forEach((device, i) => {
      console.log(`  ${i + 1}. ${device.name ?? 'Unknown'} (${device.id})`);
    });

    // 3. Connect to first device (in a real app, let user choose)
    const device = devices[0];
    console.log(`\nConnecting to ${device.name}...`);
    const client = await manager.connect(device);
    console.log('Connected!\n');

    // 4. Configure resistance settings
    console.log('Configuring device...');
    await client.setWeight(50);    // 50 lbs resistance
    await client.setChains(0);     // No chains
    await client.setEccentric(0);  // Balanced eccentric/concentric
    console.log(`Settings: ${JSON.stringify(client.settings)}\n`);

    // 5. Subscribe to telemetry
    let frameCount = 0;
    client.onFrame((frame: TelemetryFrame) => {
      frameCount++;
      // Log every 10th frame to avoid flooding console
      if (frameCount % 10 === 0) {
        console.log(
          `Frame ${frame.sequence}: ` +
          `pos=${frame.position.toFixed(0)}, ` +
          `vel=${frame.velocity.toFixed(2)}, ` +
          `force=${frame.force.toFixed(0)}`
        );
      }
    });

    // 6. Start recording (engages motor)
    console.log('Starting workout recording...');
    await client.startRecording();
    console.log('Recording! Perform some reps.\n');

    // 7. Record for 10 seconds
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // 8. Stop recording (disengages motor)
    console.log('\nStopping recording...');
    await client.stopRecording();
    console.log(`Recorded ${frameCount} frames`);

    // 9. Cleanup
    await manager.disconnectAll();
    console.log('\nDisconnected. Done!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    manager.dispose();
  }
}

main().catch(console.error);
```

Run it:

```bash
npm start
```

Expected output:

```
Voltra SDK - Node.js Tutorial

Scanning for Voltra devices...

Found 1 device(s):
  1. VTR-123456 (XX:XX:XX:XX:XX:XX)

Connecting to VTR-123456...
Connected!

Configuring device...
Settings: {"weight":50,"chains":0,"eccentric":0}

Starting workout recording...
Recording! Perform some reps.

Frame 10: pos=245, vel=1.23, force=48
Frame 20: pos=412, vel=0.87, force=52
...

Stopping recording...
Recorded 1050 frames

Disconnected. Done!
```

---

## Common Patterns

### Connect by Name

If you know the device name, connect directly without user selection:

```typescript
// Connect to device containing "VTR-123" in name
const client = await manager.connectByName('VTR-123');

// Or exact match
const client = await manager.connectByName('VTR-123456', { 
  matchMode: 'exact' 
});
```

### Interactive Device Selection

For CLI apps, let users pick a device:

```typescript
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve));

async function selectDevice(devices: DiscoveredDevice[]): Promise<DiscoveredDevice> {
  console.log('\nAvailable devices:');
  devices.forEach((d, i) => console.log(`  ${i + 1}. ${d.name}`));
  
  const answer = await question('\nSelect device (1-' + devices.length + '): ');
  const index = parseInt(answer, 10) - 1;
  
  if (index < 0 || index >= devices.length) {
    throw new Error('Invalid selection');
  }
  
  return devices[index];
}

// Usage
const devices = await manager.scan();
const selected = await selectDevice(devices);
const client = await manager.connect(selected);
```

### Change Settings During Workout

Adjust resistance between sets:

```typescript
const client = await manager.connect(device);
await client.setWeight(50);

// First set
await client.startRecording();
await new Promise((r) => setTimeout(r, 30000)); // 30 second set
await client.endSet(); // Stay prepared, motor ready

// Rest period - change weight
console.log('Rest period - adjusting weight...');
await client.setWeight(75);

// Second set - instant start since we used endSet()
await client.startRecording();
await new Promise((r) => setTimeout(r, 30000));
await client.stopRecording(); // Fully disengage
```

### Process Telemetry Data

Compute rep metrics from telemetry:

```typescript
interface Rep {
  startTime: number;
  endTime: number;
  peakForce: number;
  avgVelocity: number;
}

const reps: Rep[] = [];
let currentRep: Partial<Rep> | null = null;
let velocitySum = 0;
let velocityCount = 0;

client.onFrame((frame) => {
  // Detect rep start (movement begins)
  if (!currentRep && Math.abs(frame.velocity) > 0.5) {
    currentRep = {
      startTime: frame.timestamp,
      peakForce: frame.force,
    };
    velocitySum = 0;
    velocityCount = 0;
  }

  // During rep
  if (currentRep) {
    currentRep.peakForce = Math.max(currentRep.peakForce!, frame.force);
    velocitySum += Math.abs(frame.velocity);
    velocityCount++;

    // Detect rep end (movement stops)
    if (Math.abs(frame.velocity) < 0.1) {
      currentRep.endTime = frame.timestamp;
      currentRep.avgVelocity = velocitySum / velocityCount;
      reps.push(currentRep as Rep);
      console.log(`Rep ${reps.length}: peak=${currentRep.peakForce}N, avgVel=${currentRep.avgVelocity.toFixed(2)}`);
      currentRep = null;
    }
  }
});
```

---

## Troubleshooting

### "No Voltra devices found"

1. Is the device powered on?
2. Is it connected to Beyond+ or another app? Disconnect first.
3. Are you within Bluetooth range (~10 meters)?
4. Try increasing scan timeout: `manager.scan({ timeout: 15000 })`

### "No compatible Bluetooth adapter found"

- **macOS**: Should work automatically
- **Linux**: Install BlueZ: `sudo apt install bluez`
- **Windows**: Ensure Bluetooth is enabled in Settings

### "Operation not permitted" (Linux)

Grant Node.js Bluetooth capabilities:

```bash
sudo setcap cap_net_raw+eip $(which node)
```

Or use the full path to your Node.js binary.

### Connection drops during workout

Enable auto-reconnect:

```typescript
const manager = new VoltraManager({
  clientOptions: {
    autoReconnect: true,
    maxReconnectAttempts: 3,
  },
});
```

---

## Next Steps

- See the [complete examples](../../examples/node) for multi-device support
- Read about the [Bluetooth protocol](../concepts/bluetooth-protocol.md)
- Check [troubleshooting](../troubleshooting.md) for more solutions
