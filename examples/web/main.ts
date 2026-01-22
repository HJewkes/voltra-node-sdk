/**
 * Web Browser Example
 *
 * Demonstrates using the Voltra SDK in a web browser with the Web Bluetooth API.
 */

import { VoltraClient, WebBLEAdapter, BLE, type TelemetryFrame } from '@voltra/node-sdk';

// DOM elements
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;
const settingsCard = document.getElementById('settings-card')!;
const workoutCard = document.getElementById('workout-card')!;
const weightSelect = document.getElementById('weight-select') as HTMLSelectElement;
const applySettingsBtn = document.getElementById('apply-settings-btn') as HTMLButtonElement;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const positionValue = document.getElementById('position-value')!;
const velocityValue = document.getElementById('velocity-value')!;
const forceValue = document.getElementById('force-value')!;
const logEl = document.getElementById('log')!;

// State
let client: VoltraClient | null = null;
let adapter: WebBLEAdapter | null = null;

// Logging
function log(message: string, type: 'info' | 'error' | 'success' = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

// Update UI based on connection state
function updateUI(state: string, isRecording = false) {
  statusDot.className = 'status-dot';
  
  switch (state) {
    case 'disconnected':
      statusDot.classList.add('');
      statusText.textContent = 'Disconnected';
      scanBtn.disabled = false;
      disconnectBtn.disabled = true;
      settingsCard.style.display = 'none';
      workoutCard.style.display = 'none';
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

// Frame handler
function handleFrame(frame: TelemetryFrame) {
  positionValue.textContent = frame.position.toFixed(0);
  velocityValue.textContent = frame.velocity.toFixed(2);
  forceValue.textContent = frame.force.toFixed(0);
}

// Scan and connect
async function scanAndConnect() {
  try {
    log('Scanning for devices...');
    
    // Create adapter and client
    adapter = new WebBLEAdapter({ ble: BLE });
    client = new VoltraClient({ adapter });

    // Subscribe to events
    client.subscribe((event) => {
      switch (event.type) {
        case 'connectionStateChanged':
          updateUI(event.state, client?.isRecording);
          break;
        case 'recordingStateChanged':
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

    // Scan - this triggers the browser's Bluetooth device picker
    const devices = await client.scan();
    
    if (devices.length === 0) {
      log('No device selected', 'error');
      return;
    }

    log(`Connecting to ${devices[0].name ?? devices[0].id}...`);
    await client.connect(devices[0]);
    log('Connected!', 'success');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed: ${message}`, 'error');
    updateUI('disconnected');
  }
}

// Disconnect
async function disconnect() {
  if (!client) return;
  
  try {
    await client.disconnect();
    log('Disconnected', 'info');
  } catch (error) {
    log(`Disconnect error: ${error}`, 'error');
  } finally {
    client.dispose();
    client = null;
    adapter = null;
    updateUI('disconnected');
  }
}

// Apply settings
async function applySettings() {
  if (!client?.isConnected) return;
  
  const weight = parseInt(weightSelect.value, 10);
  try {
    await client.setWeight(weight);
    log(`Weight set to ${weight} lbs`, 'success');
  } catch (error) {
    log(`Failed to set weight: ${error}`, 'error');
  }
}

// Start recording
async function startRecording() {
  if (!client?.isConnected) return;
  
  try {
    await client.startRecording();
    log('Recording started', 'success');
  } catch (error) {
    log(`Failed to start: ${error}`, 'error');
  }
}

// Stop recording
async function stopRecording() {
  if (!client?.isConnected) return;
  
  try {
    await client.stopRecording();
    log('Recording stopped', 'success');
  } catch (error) {
    log(`Failed to stop: ${error}`, 'error');
  }
}

// Event listeners
scanBtn.addEventListener('click', scanAndConnect);
disconnectBtn.addEventListener('click', disconnect);
applySettingsBtn.addEventListener('click', applySettings);
startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);

// Initial state
updateUI('disconnected');
log('Ready. Click "Scan for Device" to begin.');
