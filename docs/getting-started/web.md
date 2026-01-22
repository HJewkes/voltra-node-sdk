# Getting Started: Web Browser

This guide walks you through running the browser example from scratch.

## Prerequisites

### 1. Install Node.js

Download and install Node.js 18 or later from [nodejs.org](https://nodejs.org/).

Verify installation:
```bash
node --version  # Should show v18.x.x or higher
npm --version   # Should show 9.x.x or higher
```

### 2. Supported Browser

Web Bluetooth is supported in:
- **Chrome** (desktop and Android) - recommended
- **Edge**
- **Opera**

**Not supported**:
- Safari (any platform)
- Firefox
- iOS browsers (all iOS browsers use WebKit which lacks Web Bluetooth)

### 3. Voltra Device

- Power on your Voltra device
- Ensure it's not connected to another app (only one connection at a time)

---

## Setup

### 1. Clone or Download the SDK

```bash
git clone https://github.com/voltra/node-sdk.git
cd node-sdk
```

### 2. Install SDK Dependencies

```bash
npm install
```

### 3. Build the SDK

```bash
npm run build
```

### 4. Navigate to Web Example

```bash
cd examples/web
```

### 5. Install Example Dependencies

```bash
npm install
```

This installs:
- `vite` - Development server with hot reload
- `typescript` - TypeScript support
- `@voltras/node-sdk` - Links to the parent SDK

---

## Running the Example

### Start the Development Server

```bash
npm run dev
```

You should see:
```
  VITE v5.x.x  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

### Open in Browser

1. Open Chrome (or Edge/Opera)
2. Navigate to `http://localhost:5173`

### Using the Demo

1. **Click "Scan for Device"** - This opens the browser's Bluetooth device picker
2. **Select your Voltra** from the picker (look for `VTR-XXXXXX`)
3. **Wait for connection** - Status changes to "Connected"
4. **Adjust weight** using the dropdown
5. **Click "Start"** to begin recording
6. **Move the Voltra** - Watch telemetry values update in real-time
7. **Click "Stop"** when done
8. **Click "Disconnect"** to release the device

---

## Important: User Gesture Requirement

Web Bluetooth **requires a user gesture** (click, tap) to trigger device scanning. This is a browser security requirement.

```typescript
// This will FAIL - no user gesture
window.onload = async () => {
  await manager.scan();  // Error!
};

// This WORKS - triggered by button click
button.onclick = async () => {
  await manager.scan();  // Opens device picker
};
```

---

## HTTPS Requirement

Web Bluetooth only works on secure contexts:
- `https://` URLs
- `localhost` / `127.0.0.1`

If you deploy to a server, it must use HTTPS.

---

## Customizing the Example

### Change Default Weight

Edit `main.ts`:
```typescript
// After connecting
await client.setWeight(75);  // Change default
```

### Add More Settings

```typescript
await client.setWeight(50);
await client.setChains(25);
await client.setEccentric(10);
```

### Custom Telemetry Display

Modify the `handleFrame` function in `main.ts`:
```typescript
function handleFrame(frame: TelemetryFrame) {
  // Add your custom display logic
  console.log('Phase:', PhaseNames[frame.phase]);
}
```

---

## Troubleshooting

### Device picker doesn't appear

- Are you using Chrome, Edge, or Opera?
- Did you click a button to trigger scan? (User gesture required)
- Is Bluetooth enabled on your computer?

### "SecurityError: requestDevice requires secure context"

You must use:
- `https://` URL, or
- `localhost` / `127.0.0.1`

### Device not shown in picker

- Is the Voltra powered on?
- Is it connected to another app? Disconnect first
- Are you within Bluetooth range?

### "NotFoundError: User cancelled the requestDevice() chooser"

User closed the picker without selecting a device. This is normal - prompt them to try again.

### Connection works but no telemetry

1. Click "Start" to begin recording
2. Move the Voltra device
3. Check browser console for errors

### Console shows errors

Open DevTools (F12) → Console tab to see detailed error messages.

---

## Building for Production

```bash
npm run build
```

This creates a `dist/` folder with static files you can deploy to any web server (must be HTTPS).

---

## Next Steps

- Review `main.ts` to understand the SDK integration
- Check `docs/concepts/platform-adapters.md` for Web Bluetooth details
- See `docs/troubleshooting.md` for common issues
