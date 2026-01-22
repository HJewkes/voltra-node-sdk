# Getting Started: Web Browser

Build web applications that connect to Voltra devices using the Web Bluetooth API.

## Prerequisites

### 1. Supported Browser

Web Bluetooth is supported in:

| Browser | Support |
|---------|---------|
| **Chrome** (desktop & Android) | Full support - recommended |
| **Edge** | Full support |
| **Opera** | Full support |
| **Safari** | Not supported |
| **Firefox** | Not supported |
| **iOS browsers** | Not supported (all use WebKit) |

### 2. HTTPS or localhost

Web Bluetooth only works on secure contexts:
- `https://` URLs
- `localhost` or `127.0.0.1`

### 3. Voltra Device

- Power on your Voltra device
- Ensure it's not connected to another app

---

## Project Setup

Create a new Vite project with TypeScript:

```bash
npm create vite@latest my-voltra-web -- --template vanilla-ts
cd my-voltra-web
npm install @voltras/node-sdk
npm install
```

---

## Your First App

Replace `src/main.ts`:

```typescript
import { VoltraManager, type VoltraClient, type TelemetryFrame } from '@voltras/node-sdk';

// State
const manager = new VoltraManager();
let client: VoltraClient | null = null;

// UI Elements
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div style="font-family: system-ui; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1>Voltra Web Demo</h1>
    
    <div id="status" style="padding: 10px; background: #f0f0f0; border-radius: 8px; margin-bottom: 20px;">
      Status: <span id="status-text">Disconnected</span>
    </div>
    
    <div id="controls">
      <button id="scan-btn" style="padding: 10px 20px; font-size: 16px;">
        Scan for Device
      </button>
      <button id="disconnect-btn" style="padding: 10px 20px; font-size: 16px; display: none;">
        Disconnect
      </button>
    </div>
    
    <div id="settings" style="display: none; margin-top: 20px;">
      <h3>Settings</h3>
      <label>
        Weight: 
        <select id="weight-select">
          <option value="25">25 lbs</option>
          <option value="50" selected>50 lbs</option>
          <option value="75">75 lbs</option>
          <option value="100">100 lbs</option>
        </select>
      </label>
      <button id="apply-btn">Apply</button>
    </div>
    
    <div id="workout" style="display: none; margin-top: 20px;">
      <h3>Workout</h3>
      <button id="start-btn" style="background: #4caf50; color: white; padding: 10px 20px;">
        Start Recording
      </button>
      <button id="stop-btn" style="background: #f44336; color: white; padding: 10px 20px;" disabled>
        Stop Recording
      </button>
      
      <div id="metrics" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 20px;">
        <div style="text-align: center; padding: 20px; background: #e3f2fd; border-radius: 8px;">
          <div id="position" style="font-size: 24px; font-weight: bold;">--</div>
          <div>Position</div>
        </div>
        <div style="text-align: center; padding: 20px; background: #e8f5e9; border-radius: 8px;">
          <div id="velocity" style="font-size: 24px; font-weight: bold;">--</div>
          <div>Velocity</div>
        </div>
        <div style="text-align: center; padding: 20px; background: #fff3e0; border-radius: 8px;">
          <div id="force" style="font-size: 24px; font-weight: bold;">--</div>
          <div>Force</div>
        </div>
      </div>
    </div>
  </div>
`;

// Get elements
const statusText = document.getElementById('status-text')!;
const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;
const settingsDiv = document.getElementById('settings')!;
const workoutDiv = document.getElementById('workout')!;
const weightSelect = document.getElementById('weight-select') as HTMLSelectElement;
const applyBtn = document.getElementById('apply-btn') as HTMLButtonElement;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const positionEl = document.getElementById('position')!;
const velocityEl = document.getElementById('velocity')!;
const forceEl = document.getElementById('force')!;

// Update UI state
function updateUI(connected: boolean, recording: boolean = false) {
  scanBtn.style.display = connected ? 'none' : 'inline-block';
  disconnectBtn.style.display = connected ? 'inline-block' : 'none';
  settingsDiv.style.display = connected ? 'block' : 'none';
  workoutDiv.style.display = connected ? 'block' : 'none';
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;
  statusText.textContent = recording ? 'Recording' : (connected ? 'Connected' : 'Disconnected');
}

// Handle telemetry
function handleFrame(frame: TelemetryFrame) {
  positionEl.textContent = frame.position.toFixed(0);
  velocityEl.textContent = frame.velocity.toFixed(2);
  forceEl.textContent = frame.force.toFixed(0);
}

// Scan and connect
scanBtn.addEventListener('click', async () => {
  try {
    statusText.textContent = 'Scanning...';
    
    // Web Bluetooth shows a device picker - user must select
    // connectFirst() triggers the picker and connects to selection
    client = await manager.connectFirst();
    
    statusText.textContent = `Connected to ${client.connectedDeviceName}`;
    
    // Subscribe to telemetry
    client.onFrame(handleFrame);
    
    // Subscribe to recording state changes
    client.subscribe((event) => {
      if (event.type === 'recordingStateChanged') {
        updateUI(true, event.state === 'active');
      }
    });
    
    // Apply initial weight
    await client.setWeight(parseInt(weightSelect.value));
    
    updateUI(true);
  } catch (error) {
    statusText.textContent = `Error: ${error instanceof Error ? error.message : error}`;
    updateUI(false);
  }
});

// Disconnect
disconnectBtn.addEventListener('click', async () => {
  await manager.disconnectAll();
  client = null;
  updateUI(false);
});

// Apply settings
applyBtn.addEventListener('click', async () => {
  if (!client?.isConnected) return;
  try {
    await client.setWeight(parseInt(weightSelect.value));
    statusText.textContent = `Weight set to ${weightSelect.value} lbs`;
  } catch (error) {
    statusText.textContent = `Error: ${error}`;
  }
});

// Start recording
startBtn.addEventListener('click', async () => {
  if (!client?.isConnected) return;
  try {
    await client.startRecording();
  } catch (error) {
    statusText.textContent = `Error: ${error}`;
  }
});

// Stop recording
stopBtn.addEventListener('click', async () => {
  if (!client?.isConnected) return;
  try {
    await client.stopRecording();
  } catch (error) {
    statusText.textContent = `Error: ${error}`;
  }
});
```

Run the development server:

```bash
npm run dev
```

Open Chrome to `http://localhost:5173`.

---

## Important: User Gesture Requirement

Web Bluetooth **requires a user gesture** (click, tap) to trigger scanning. This is a browser security feature.

```typescript
// This will FAIL - no user gesture
window.onload = async () => {
  await manager.scan();  // SecurityError!
};

// This WORKS - triggered by button click
button.onclick = async () => {
  await manager.scan();  // Opens device picker
};
```

---

## Device Selection in Web

Unlike Node.js where you get a list of all devices, Web Bluetooth shows a **browser-native picker**:

```typescript
// In Node.js - you get an array, show your own UI
const devices = await manager.scan();
console.log(devices); // [{id: '...', name: 'VTR-123'}, {...}]

// In Web - browser shows a picker, returns selected device
const devices = await manager.scan();
console.log(devices); // [{id: '...', name: 'VTR-123'}] - only the selected one!
```

The `connectFirst()` method is actually the most natural for web apps:

```typescript
// This opens the browser picker and connects to whatever user selects
const client = await manager.connectFirst();
```

---

## Advanced Patterns

### Full Settings Control

```typescript
// Weight selection
const weightSelect = document.createElement('select');
for (const weight of client.getAvailableWeights()) {
  const option = document.createElement('option');
  option.value = String(weight);
  option.textContent = `${weight} lbs`;
  weightSelect.appendChild(option);
}

// Chains slider
const chainsSlider = document.createElement('input');
chainsSlider.type = 'range';
chainsSlider.min = '0';
chainsSlider.max = '100';
chainsSlider.value = '0';

// Eccentric slider
const eccentricSlider = document.createElement('input');
eccentricSlider.type = 'range';
eccentricSlider.min = '-195';
eccentricSlider.max = '195';
eccentricSlider.value = '0';

// Apply all settings
async function applySettings() {
  await client.setWeight(parseInt(weightSelect.value));
  await client.setChains(parseInt(chainsSlider.value));
  await client.setEccentric(parseInt(eccentricSlider.value));
}
```

### Live Chart with Canvas

```typescript
const canvas = document.createElement('canvas');
canvas.width = 600;
canvas.height = 200;
const ctx = canvas.getContext('2d')!;

const history: number[] = [];
const MAX_POINTS = 200;

client.onFrame((frame) => {
  history.push(frame.position);
  if (history.length > MAX_POINTS) history.shift();
  
  // Clear
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw line
  ctx.beginPath();
  ctx.strokeStyle = '#2196f3';
  ctx.lineWidth = 2;
  
  history.forEach((pos, i) => {
    const x = (i / MAX_POINTS) * canvas.width;
    const y = canvas.height - (pos / 600) * canvas.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  
  ctx.stroke();
});
```

### Handle Connection Loss

```typescript
client.subscribe((event) => {
  switch (event.type) {
    case 'connectionStateChanged':
      if (event.state === 'disconnected') {
        showReconnectPrompt();
      }
      break;
    case 'error':
      showErrorNotification(event.error.message);
      break;
  }
});

async function showReconnectPrompt() {
  if (confirm('Connection lost. Reconnect?')) {
    try {
      client = await manager.connectFirst();
    } catch (e) {
      alert('Reconnection failed');
    }
  }
}
```

---

## Building for Production

```bash
npm run build
```

This creates a `dist/` folder. Deploy to any web server that supports HTTPS.

### Deployment Checklist

1. **HTTPS required** - Web Bluetooth won't work on HTTP
2. **Supported browsers only** - Show a message for Safari/Firefox users
3. **Mobile considerations** - Works on Android Chrome, but not iOS

```typescript
// Check for Web Bluetooth support
if (!navigator.bluetooth) {
  showMessage('Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or Opera.');
}
```

---

## Troubleshooting

### Device picker doesn't appear

- Are you using Chrome, Edge, or Opera?
- Did you click a button? (User gesture required)
- Is Bluetooth enabled on your computer?

### "SecurityError: requestDevice requires secure context"

Use `https://` or `localhost`.

### Device not shown in picker

- Is the Voltra powered on?
- Is it connected to another app? Disconnect first.
- Are you within Bluetooth range?

### "NotFoundError: User cancelled the chooser"

User closed the picker without selecting. This is normal - prompt them to try again.

---

## Next Steps

- See the [complete web example](../../examples/web) with full UI
- Read about [Web Bluetooth limitations](../concepts/platform-adapters.md)
- Check [troubleshooting](../troubleshooting.md) for more solutions
