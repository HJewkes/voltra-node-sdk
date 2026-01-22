# Web Browser Example

Interactive web application demonstrating all features of the Voltra SDK using the Web Bluetooth API.

## Prerequisites

- Chrome, Edge, or Opera (browsers that support Web Bluetooth)
- A Voltra device (powered on, not connected to another app)
- HTTPS or localhost (Web Bluetooth security requirement)

## Setup

From the SDK root directory:

```bash
npm install
npm run build
cd examples/web
npm install
```

## Running

```bash
npm run dev
```

Open http://localhost:5173 in Chrome, Edge, or Opera.

## Features Demonstrated

### Device Connection
- **Device picker** - Browser-native Bluetooth device selection
- **Connection states** - Visual feedback during connecting/authenticating
- **Status display** - Real-time connection status

### Resistance Settings
- **Weight** - Primary resistance (5-200 lbs in increments of 5)
- **Chains** - Reverse resistance slider (0-100 lbs)
- **Eccentric** - Eccentric load adjustment slider (-195% to +195%)
- **Apply settings** - Send all settings to device with one click

### Workout Recording
- **Start/Stop** - Control motor engagement
- **Real-time telemetry** - Position, velocity, and force metrics
- **Frame counter** - Track collected telemetry frames
- **Activity log** - Detailed event and error logging

## How to Use

1. **Click "Scan for Device"** - Opens browser's Bluetooth picker
2. **Select your Voltra** - Look for `VTR-XXXXXX` in the list
3. **Configure settings** - Adjust weight, chains, and eccentric
4. **Click "Apply Settings"** - Sends configuration to device
5. **Click "Start Recording"** - Engages motor, begins telemetry
6. **Perform your workout** - Watch metrics update in real-time
7. **Click "Stop Recording"** - Disengages motor
8. **Click "Disconnect"** - Closes connection when done

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome (desktop & Android) | Full support |
| Edge | Full support |
| Opera | Full support |
| Firefox | Not supported |
| Safari | Not supported |
| iOS browsers | Not supported (all use WebKit) |

## Technical Notes

### User Gesture Requirement

Web Bluetooth requires a user gesture (click, tap) to trigger scanning. This is why:
- Scanning must be triggered by a button click
- You cannot auto-scan on page load
- The browser shows a native picker dialog

### HTTPS Requirement

Web Bluetooth only works on secure contexts:
- `https://` URLs in production
- `localhost` or `127.0.0.1` for development

### Device Selection Differences

Unlike Node.js where `scan()` returns all devices, in browsers:
- `scan()` shows a picker and returns only the selected device
- `connectFirst()` effectively does the same thing
- Multi-device support requires multiple user interactions

## Building for Production

```bash
npm run build
```

This creates a `dist/` folder with static files. Deploy to any HTTPS-enabled web server.

## Troubleshooting

**Device picker doesn't appear:**
- Are you using Chrome, Edge, or Opera?
- Did you click the button? (User gesture required)
- Is Bluetooth enabled on your computer?

**Device not shown in picker:**
- Is the Voltra powered on?
- Is it connected to Beyond+ or another app?
- Are you within Bluetooth range?

**"SecurityError: requestDevice requires secure context":**
- Must use `https://` or `localhost`

**"NotFoundError: User cancelled the chooser":**
- User closed the picker without selecting - normal behavior
