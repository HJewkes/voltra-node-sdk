/**
 * Web Browser Example
 *
 * Demonstrates the complete SDK workflow in a browser:
 * - Scanning for devices (opens browser device picker)
 * - Connecting to user-selected device
 * - Configuring resistance settings (weight, chains, eccentric)
 * - Recording workouts with real-time telemetry
 * - Displaying live metrics
 *
 * Note: Web Bluetooth requires a user gesture (click) to scan,
 * and only works on HTTPS or localhost.
 */

import {
  VoltraManager,
  type VoltraClient,
  type TelemetryFrame,
} from '@voltras/node-sdk';

// State
const manager = new VoltraManager();  // Auto-detects web platform
let client: VoltraClient | null = null;
let frameCount = 0;

// DOM elements
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;
const settingsCard = document.getElementById('settings-card')!;
const workoutCard = document.getElementById('workout-card')!;
const weightSelect = document.getElementById('weight-select') as HTMLSelectElement;
const chainsSlider = document.getElementById('chains-slider') as HTMLInputElement;
const chainsValue = document.getElementById('chains-value')!;
const eccentricSlider = document.getElementById('eccentric-slider') as HTMLInputElement;
const eccentricValue = document.getElementById('eccentric-value')!;
const applySettingsBtn = document.getElementById('apply-settings-btn') as HTMLButtonElement;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const positionValue = document.getElementById('position-value')!;
const velocityValue = document.getElementById('velocity-value')!;
const forceValue = document.getElementById('force-value')!;
const frameCountEl = document.getElementById('frame-count')!;
const currentSettingsEl = document.getElementById('current-settings')!;
const logEl = document.getElementById('log')!;

// Logging
function log(message: string, type: 'info' | 'error' | 'success' = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
  
  // Keep only last 50 entries
  while (logEl.children.length > 50) {
    logEl.removeChild(logEl.firstChild!);
  }
}

// Update UI based on connection/recording state
function updateUI(state: string, isRecording = false) {
  statusDot.className = 'status-dot';
  
  switch (state) {
    case 'disconnected':
      statusText.textContent = 'Disconnected';
      scanBtn.disabled = false;
      disconnectBtn.disabled = true;
      settingsCard.style.display = 'none';
      workoutCard.style.display = 'none';
      currentSettingsEl.textContent = '';
      break;
    case 'connecting':
    case 'authenticating':
      statusDot.classList.add('connecting');
      statusText.textContent = state.charAt(0).toUpperCase() + state.slice(1) + '...';
      scanBtn.disabled = true;
      break;
    case 'connected':
      statusDot.classList.add(isRecording ? 'recording' : 'connected');
      statusText.textContent = isRecording ? 'Recording' : 'Connected';
      scanBtn.disabled = true;
      disconnectBtn.disabled = false;
      settingsCard.style.display = 'block';
      workoutCard.style.display = 'block';
      startBtn.disabled = isRecording;
      stopBtn.disabled = !isRecording;
      break;
  }
}

// Update current settings display
function updateSettingsDisplay() {
  if (!client) return;
  const { weight, chains, eccentric } = client.settings;
  currentSettingsEl.textContent = `Current: ${weight} lbs | Chains: ${chains} lbs | Eccentric: ${eccentric >= 0 ? '+' : ''}${eccentric}%`;
}

// Handle incoming telemetry frame
function handleFrame(frame: TelemetryFrame) {
  frameCount++;
  
  // Update metric displays
  positionValue.textContent = frame.position.toFixed(0);
  velocityValue.textContent = frame.velocity.toFixed(2);
  forceValue.textContent = frame.force.toFixed(0);
  frameCountEl.textContent = `Frames: ${frameCount}`;
}

// Scan for devices and connect to user selection
async function scanAndConnect() {
  try {
    log('Opening device picker...');
    updateUI('connecting');
    
    // Web Bluetooth shows a native device picker
    // connectFirst() returns whichever device the user selects
    client = await manager.connectFirst({ timeout: 30000 });
    
    log(`Connected to ${client.connectedDeviceName ?? client.connectedDeviceId}!`, 'success');

    // Subscribe to all events
    client.subscribe((event) => {
      switch (event.type) {
        case 'connectionStateChanged':
          log(`Connection state: ${event.state}`);
          updateUI(event.state, client?.isRecording);
          break;
        case 'recordingStateChanged':
          log(`Recording state: ${event.state}`);
          updateUI('connected', event.state === 'active');
          break;
        case 'frame':
          handleFrame(event.frame);
          break;
        case 'error':
          log(`Error: ${event.error.message}`, 'error');
          break;
      }
    });

    // Reset frame counter
    frameCount = 0;
    frameCountEl.textContent = 'Frames: 0';

    updateUI('connected');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Connection failed: ${message}`, 'error');
    updateUI('disconnected');
  }
}

// Disconnect from device
async function disconnect() {
  if (!client) return;
  
  try {
    log('Disconnecting...');
    await manager.disconnectAll();
    log('Disconnected', 'info');
  } catch (error) {
    log(`Disconnect error: ${error}`, 'error');
  } finally {
    client = null;
    updateUI('disconnected');
  }
}

// Apply resistance settings
async function applySettings() {
  if (!client?.isConnected) return;
  
  const weight = parseInt(weightSelect.value, 10);
  const chains = parseInt(chainsSlider.value, 10);
  const eccentric = parseInt(eccentricSlider.value, 10);

  try {
    log(`Applying settings: ${weight} lbs, chains ${chains} lbs, eccentric ${eccentric}%...`);
    
    await client.setWeight(weight);
    await client.setChains(chains);
    await client.setEccentric(eccentric);
    
    log('Settings applied!', 'success');
    updateSettingsDisplay();
  } catch (error) {
    log(`Failed to apply settings: ${error}`, 'error');
  }
}

// Start recording (engages motor)
async function startRecording() {
  if (!client?.isConnected) return;
  
  try {
    log('Starting recording...');
    frameCount = 0;
    await client.startRecording();
    log('Recording started - motor engaged', 'success');
  } catch (error) {
    log(`Failed to start recording: ${error}`, 'error');
  }
}

// Stop recording (disengages motor)
async function stopRecording() {
  if (!client?.isConnected) return;
  
  try {
    log('Stopping recording...');
    await client.stopRecording();
    log(`Recording stopped - ${frameCount} frames collected`, 'success');
  } catch (error) {
    log(`Failed to stop recording: ${error}`, 'error');
  }
}

// Update slider value displays
function updateSliderDisplays() {
  chainsValue.textContent = `${chainsSlider.value} lbs`;
  eccentricValue.textContent = `${parseInt(eccentricSlider.value) >= 0 ? '+' : ''}${eccentricSlider.value}%`;
}

// Event listeners
scanBtn.addEventListener('click', scanAndConnect);
disconnectBtn.addEventListener('click', disconnect);
applySettingsBtn.addEventListener('click', applySettings);
startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
chainsSlider.addEventListener('input', updateSliderDisplays);
eccentricSlider.addEventListener('input', updateSliderDisplays);

// Initial state
updateUI('disconnected');
updateSliderDisplays();
log('Ready. Click "Scan for Device" to begin.');
log('Note: Web Bluetooth requires Chrome, Edge, or Opera.');
