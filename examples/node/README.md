# Node.js Examples

Complete Node.js examples demonstrating all features of the Voltra SDK.

## Prerequisites

- Node.js 18+
- A Voltra device (powered on, not connected to another app)
- Bluetooth adapter on your machine

## Setup

From the SDK root directory:

```bash
npm install
npm run build
cd examples/node
npm install
```

## Examples

### Basic Connection (`npm start`)

Demonstrates the complete SDK workflow with a single device:

1. **Scanning** - Find nearby Voltra devices
2. **Connecting** - Connect to a selected device
3. **Configuring** - Set weight, chains, and eccentric resistance
4. **Recording** - Start recording (engages motor)
5. **Telemetry** - Collect real-time position, velocity, and force data
6. **Analysis** - Process collected telemetry data
7. **Cleanup** - Stop recording and disconnect

```bash
npm start
```

Example output:

```
Step 1: Scanning for Voltra devices...
Found 1 device(s):
  1. VTR-123456 (XX:XX:XX:XX:XX:XX)

Step 2: Connecting to VTR-123456...
Connected!

Step 3: Configuring resistance settings...
  Setting weight to 50 lbs...
  Setting chains to 10 lbs...
  Setting eccentric to 0% (balanced)...

Step 5: Starting recording...
Recording active! Perform some reps.

  Frame 100: pos=245, vel=  1.23, force=  48, phase=1
  Frame 120: pos=412, vel=  0.87, force=  52, phase=2
  ...

Step 8: Analyzing telemetry data...
  Total frames: 1050
  Duration: 10.0s
  Position range: 45 - 580
  Peak velocity: 2.34
  Peak force: 65
```

### Multi-Device (`npm run multi`)

Demonstrates connecting to and controlling multiple Voltra devices simultaneously:

1. **Multi-scan** - Discover all nearby devices
2. **Multi-connect** - Connect to up to 3 devices
3. **Per-device config** - Configure each device independently
4. **Synchronized recording** - Start all devices together
5. **Per-device telemetry** - Track frames from each device
6. **Comparative analysis** - Display stats for all devices

```bash
npm run multi
```

Example output:

```
Scanning for Voltra devices...
Found 2 device(s):
  1. VTR-123456
  2. VTR-789012

Connecting to 2 device(s)...
[VTR-123456] Connected
[VTR-789012] Connected

Configuring all devices...
[VTR-123456] Set to 50 lbs
[VTR-789012] Set to 60 lbs

Starting recording on all devices...

[VTR-123456] Frame 30: pos=234, vel=1.12
[VTR-789012] Frame 30: pos=456, vel=0.98
...

WORKOUT SUMMARY
============================================================

[VTR-123456]
  Weight: 50 lbs
  Frames collected: 1050
  Peak force: 52
  
[VTR-789012]
  Weight: 60 lbs
  Frames collected: 1048
  Peak force: 61
```

## Customization

Edit the example files to try different scenarios:

```typescript
// Change weight (5-200 lbs in increments of 5)
await client.setWeight(75);

// Add chains resistance (0-100 lbs)
await client.setChains(25);

// Adjust eccentric load (-195% to +195%)
await client.setEccentric(-20);  // 20% less on lowering phase

// Connect by name instead of scan
const client = await manager.connectByName('VTR-123456');

// Increase scan timeout
const devices = await manager.scan({ timeout: 15000 });
```

## Troubleshooting

**No devices found:**
- Ensure your Voltra is powered on
- Disconnect from Beyond+ or other apps
- Check that Bluetooth is enabled
- Move closer to the device

**Permission errors (Linux):**
```bash
sudo setcap cap_net_raw+eip $(which node)
```

**Cannot find module '@voltras/node-sdk':**
- Build the SDK first: `npm run build` in root directory
- Install example dependencies: `npm install` in examples/node/
