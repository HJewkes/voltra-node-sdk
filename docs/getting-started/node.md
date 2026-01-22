# Getting Started: Node.js

This guide walks you through running the Node.js example from scratch.

## Prerequisites

### 1. Install Node.js

Download and install Node.js 18 or later from [nodejs.org](https://nodejs.org/).

Verify installation:
```bash
node --version  # Should show v18.x.x or higher
npm --version   # Should show 9.x.x or higher
```

### 2. Bluetooth Hardware

Your computer needs Bluetooth support:

| OS | Requirements |
|----|--------------|
| **macOS** | Built-in Bluetooth works automatically |
| **Linux** | BlueZ 5.43+ required: `sudo apt install bluez` |
| **Windows** | Windows 10+ with Bluetooth adapter |

### 3. Voltra Device

- Power on your Voltra device
- Note its name (e.g., `VTR-123456`) - visible on the device or in Beyond+ app
- Ensure it's not connected to another app (only one connection at a time)

---

## Setup

### 1. Clone or Download the SDK

```bash
git clone https://github.com/voltra/node-sdk.git
cd node-sdk
```

Or download and extract the ZIP from GitHub.

### 2. Install SDK Dependencies

```bash
npm install
```

### 3. Build the SDK

```bash
npm run build
```

### 4. Navigate to Node Example

```bash
cd examples/node
```

### 5. Install Example Dependencies

```bash
npm install
```

This installs:
- `tsx` - TypeScript execution without compilation
- `@voltras/node-sdk` - Links to the parent SDK

---

## Running the Example

### Basic Connection Example

```bash
npm start
```

This runs `basic-connection.ts` which:
1. Scans for Voltra devices
2. Connects to the first one found
3. Sets weight to 50 lbs
4. Streams telemetry for 10 seconds
5. Disconnects

**Expected output**:
```
Voltra SDK - Node.js Example

Scanning for Voltra devices...
Connected to VTR-123456

Setting weight to 50 lbs...

Starting recording...
Recording active. Perform some reps!

Frame 10: pos=245, vel=1.23, phase=1
Frame 20: pos=412, vel=0.87, phase=2
...

Recorded 110 frames
Disconnected. Goodbye!
```

### Multi-Device Example

```bash
npm run multi
```

This demonstrates connecting to multiple Voltra devices simultaneously.

---

## Connecting to a Specific Device

Edit `basic-connection.ts` to connect by name:

```typescript
// Instead of connectFirst():
const client = await manager.connectByName('VTR-123456');
```

Or modify the timeout:
```typescript
const client = await manager.connectFirst({ timeout: 15000 });
```

---

## Troubleshooting

### "No Voltra devices found"

1. Is the device powered on?
2. Is it already connected to Beyond+ or another app?
3. Are you within Bluetooth range (~10 meters)?
4. Try increasing the scan timeout

### "No compatible Bluetooth adapter found"

- **macOS**: Should work automatically
- **Linux**: Install BlueZ: `sudo apt install bluez`
- **Windows**: Ensure Bluetooth is enabled in Settings

### "Operation not permitted" (Linux)

Grant Node.js Bluetooth capabilities:
```bash
sudo setcap cap_net_raw+eip $(which node)
```

Or run with sudo (not recommended for production):
```bash
sudo npm start
```

### "Cannot find module '@voltras/node-sdk'"

Ensure you:
1. Built the SDK: `npm run build` in the root directory
2. Installed example dependencies: `npm install` in `examples/node/`

---

## Next Steps

- Modify `basic-connection.ts` to try different settings (weight, chains, eccentric)
- Look at `multi-device.ts` for multi-device patterns
- Check `docs/concepts/bluetooth-protocol.md` for protocol details
- Review `docs/troubleshooting.md` for common issues
