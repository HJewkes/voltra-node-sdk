/**
 * Multi-Device Example
 *
 * Demonstrates connecting to and controlling multiple Voltra devices
 * simultaneously. Useful for:
 * - Gym environments with multiple devices
 * - Bilateral training (left/right)
 * - Research/testing scenarios
 *
 * Usage: npm run multi
 */

import {
  VoltraManager,
  type DiscoveredDevice,
  type VoltraClient,
  type TelemetryFrame,
} from '@voltras/node-sdk';

// Per-device state
interface DeviceState {
  client: VoltraClient;
  name: string;
  frames: TelemetryFrame[];
}

async function main() {
  console.log('Voltra SDK - Multi-Device Example\n');

  // Create manager
  const manager = new VoltraManager();

  // Track state per device
  const deviceStates = new Map<string, DeviceState>();

  // =========================================================================
  // Set up event listeners BEFORE scanning
  // =========================================================================
  
  manager.onDeviceConnected((client, deviceId, deviceName) => {
    console.log(`[${deviceName ?? deviceId}] Connected`);
    
    // Initialize state for this device
    deviceStates.set(deviceId, {
      client,
      name: deviceName ?? deviceId,
      frames: [],
    });

    // Subscribe to telemetry for this device
    client.onFrame((frame) => {
      const state = deviceStates.get(deviceId);
      if (state) {
        state.frames.push(frame);
        
        // Log every 30th frame
        if (state.frames.length % 30 === 0) {
          console.log(
            `[${state.name}] Frame ${frame.sequence}: ` +
            `pos=${frame.position.toFixed(0)}, ` +
            `vel=${frame.velocity.toFixed(2)}`
          );
        }
      }
    });
  });

  manager.onDeviceDisconnected((deviceId) => {
    const state = deviceStates.get(deviceId);
    console.log(`[${state?.name ?? deviceId}] Disconnected`);
    deviceStates.delete(deviceId);
  });

  try {
    // =========================================================================
    // Step 1: Scan for all devices
    // =========================================================================
    console.log('Scanning for Voltra devices...');
    const devices = await manager.scan({ timeout: 15000 });

    if (devices.length === 0) {
      console.log('No Voltra devices found.');
      return;
    }

    console.log(`\nFound ${devices.length} device(s):`);
    devices.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.name ?? 'Unknown'} (${d.id})`);
    });

    // =========================================================================
    // Step 2: Connect to devices (up to 3)
    // =========================================================================
    const maxDevices = Math.min(devices.length, 3);
    const devicesToConnect = devices.slice(0, maxDevices);

    console.log(`\nConnecting to ${devicesToConnect.length} device(s)...`);

    // Connect sequentially (parallel connections can be flaky)
    for (const device of devicesToConnect) {
      try {
        console.log(`Connecting to ${device.name}...`);
        await manager.connect(device);
      } catch (error) {
        console.error(`Failed to connect to ${device.name}:`, error);
      }
    }

    const connectedCount = manager.connectedCount;
    console.log(`\nSuccessfully connected to ${connectedCount} device(s)`);

    if (connectedCount === 0) {
      console.log('No devices connected. Exiting.');
      return;
    }

    // =========================================================================
    // Step 3: Configure all devices
    // =========================================================================
    console.log('\nConfiguring all devices...');
    
    // Set different weights per device for demonstration
    const weights = [50, 60, 70];
    let deviceIndex = 0;

    for (const client of manager.getAllClients()) {
      const weight = weights[deviceIndex % weights.length];
      await client.setWeight(weight);
      await client.setChains(0);
      await client.setEccentric(0);
      console.log(`[${client.connectedDeviceName}] Set to ${weight} lbs`);
      deviceIndex++;
    }

    // =========================================================================
    // Step 4: Start recording on all devices
    // =========================================================================
    console.log('\nPreparing all devices for recording...');
    
    // Prepare all devices first (for synchronized start)
    for (const client of manager.getAllClients()) {
      await client.prepareRecording();
      console.log(`[${client.connectedDeviceName}] Prepared (state: ${client.recordingState})`);
    }

    console.log('\nStarting recording on all devices...');
    
    // Start all devices
    for (const client of manager.getAllClients()) {
      await client.startRecording();
      console.log(`[${client.connectedDeviceName}] Recording (state: ${client.recordingState})`);
    }

    // =========================================================================
    // Step 5: Record for 10 seconds
    // =========================================================================
    console.log('\nRecording for 10 seconds. Perform some reps on all devices!\n');
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // =========================================================================
    // Step 6: Stop recording and collect stats
    // =========================================================================
    console.log('\n\nStopping recording...');
    
    for (const client of manager.getAllClients()) {
      await client.stopRecording();
    }

    // =========================================================================
    // Step 7: Display per-device statistics
    // =========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('WORKOUT SUMMARY');
    console.log('='.repeat(60));

    for (const [deviceId, state] of deviceStates) {
      const { name, frames, client } = state;
      
      console.log(`\n[${name}]`);
      console.log(`  Weight: ${client.settings.weight} lbs`);
      console.log(`  Frames collected: ${frames.length}`);

      if (frames.length > 0) {
        const positions = frames.map((f) => f.position);
        const velocities = frames.map((f) => Math.abs(f.velocity));
        const forces = frames.map((f) => f.force);

        const duration = (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000;
        
        console.log(`  Duration: ${duration.toFixed(1)}s`);
        console.log(`  Position range: ${Math.min(...positions).toFixed(0)} - ${Math.max(...positions).toFixed(0)}`);
        console.log(`  Peak velocity: ${Math.max(...velocities).toFixed(2)}`);
        console.log(`  Peak force: ${Math.max(...forces).toFixed(0)}`);
        console.log(`  Avg force: ${(forces.reduce((a, b) => a + b, 0) / forces.length).toFixed(0)}`);
      }
    }

    // =========================================================================
    // Step 8: Access individual devices by ID
    // =========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('DEVICE ACCESS EXAMPLES');
    console.log('='.repeat(60));

    // Get all connected device IDs
    console.log('\nConnected device IDs:', manager.connectedDeviceIds);

    // Access a specific device by ID
    if (devices.length > 0) {
      const firstDeviceId = devices[0].id;
      const specificClient = manager.getClient(firstDeviceId);
      if (specificClient) {
        console.log(`\nAccessed ${specificClient.connectedDeviceName} by ID:`);
        console.log(`  Settings: ${JSON.stringify(specificClient.settings)}`);
        console.log(`  Is connected: ${specificClient.isConnected}`);
      }
    }

    // =========================================================================
    // Step 9: Cleanup
    // =========================================================================
    console.log('\nDisconnecting all devices...');
    await manager.disconnectAll();
    console.log('All devices disconnected. Goodbye!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    manager.dispose();
  }
}

main().catch(console.error);
