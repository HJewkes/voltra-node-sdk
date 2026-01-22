# Node.js Example

Example Node.js application demonstrating the Voltra SDK.

## Prerequisites

- Node.js 18+
- A Voltra device
- Bluetooth adapter on your machine

## Setup

```bash
npm install
```

## Running

### Basic Connection

Connect to a single device and record telemetry:

```bash
npm start
```

### Multi-Device

Connect to multiple devices simultaneously:

```bash
npm run multi
```

## What it does

1. Scans for nearby Voltra devices
2. Connects to the device(s)
3. Configures weight settings
4. Records telemetry for 10 seconds
5. Displays frame data
6. Disconnects cleanly

## Troubleshooting

**No devices found:**
- Ensure your Voltra is powered on
- Check that Bluetooth is enabled on your computer
- Try moving closer to the device

**Permission errors:**
- On Linux, you may need to run with `sudo` or configure Bluetooth permissions
- On macOS, grant Bluetooth permission in System Preferences
