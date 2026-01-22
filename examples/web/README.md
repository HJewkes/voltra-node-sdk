# Web Browser Example

Example web application demonstrating the Voltra SDK with the Web Bluetooth API.

## Prerequisites

- A browser that supports Web Bluetooth (Chrome, Edge, Opera)
- A Voltra device
- HTTPS or localhost (required for Web Bluetooth)

## Setup

```bash
npm install
```

## Running

```bash
npm run dev
```

Then open http://localhost:5173 in your browser.

## Features

- Scan for and connect to Voltra devices
- Configure weight settings
- Start/stop workout recording
- Real-time telemetry display (position, velocity, force)
- Connection status and logging

## How It Works

1. Click "Scan for Device" - this triggers the browser's Bluetooth device picker
2. Select your Voltra device from the list
3. Configure weight settings
4. Click "Start Recording" to begin a workout
5. Watch the metrics update in real-time
6. Click "Stop Recording" when done
7. Click "Disconnect" to close the connection

## Browser Notes

- **Chrome/Edge/Opera**: Full support for Web Bluetooth
- **Firefox**: Not supported (no Web Bluetooth)
- **Safari**: Limited support (requires enabling experimental features)

The Web Bluetooth API requires user gesture to initiate scanning, which is why
the "Scan for Device" button triggers the browser's native device picker dialog.
