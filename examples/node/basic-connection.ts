/**
 * Basic Connection Example
 *
 * Demonstrates the complete SDK workflow:
 * - Scanning for devices
 * - Connecting to a selected device
 * - Configuring all resistance settings (weight, chains, eccentric)
 * - Recording a workout with telemetry collection
 * - Processing telemetry data
 *
 * Usage: npm start
 */

import {
  VoltraManager,
  type TelemetryFrame,
  type DiscoveredDevice,
} from '@voltras/node-sdk';

async function main() {
  console.log('Voltra SDK - Node.js Example\n');
  console.log('This example demonstrates the full SDK workflow.\n');

  // Create manager - auto-detects platform
  const manager = new VoltraManager();

  try {
    // =========================================================================
    // Step 1: Scan for devices
    // =========================================================================
    console.log('Step 1: Scanning for Voltra devices...');
    const devices = await manager.scan({ timeout: 10000 });

    if (devices.length === 0) {
      console.log('\nNo Voltra devices found.');
      console.log('Make sure your device is:');
      console.log('  - Powered on');
      console.log('  - Not connected to another app (e.g., Beyond+)');
      console.log('  - Within Bluetooth range (~10 meters)');
      return;
    }

    console.log(`\nFound ${devices.length} device(s):`);
    devices.forEach((device, index) => {
      console.log(`  ${index + 1}. ${device.name ?? 'Unknown'} (${device.id})`);
    });

    // =========================================================================
    // Step 2: Connect to a device
    // =========================================================================
    // In a real app, you'd let the user choose. Here we connect to the first.
    const selectedDevice: DiscoveredDevice = devices[0];
    console.log(`\nStep 2: Connecting to ${selectedDevice.name}...`);
    
    const client = await manager.connect(selectedDevice);
    console.log(`Connected to ${client.connectedDeviceName ?? client.connectedDeviceId}!`);

    // =========================================================================
    // Step 3: Configure resistance settings
    // =========================================================================
    console.log('\nStep 3: Configuring resistance settings...');

    // Set primary weight (5-200 lbs in increments of 5)
    console.log('  Setting weight to 50 lbs...');
    await client.setWeight(50);

    // Set chains (0-100 lbs) - reduces load as you extend
    console.log('  Setting chains to 10 lbs...');
    await client.setChains(10);

    // Set eccentric adjustment (-195% to +195%) - adjusts lowering phase
    console.log('  Setting eccentric to 0% (balanced)...');
    await client.setEccentric(0);

    console.log(`\nCurrent settings: ${JSON.stringify(client.settings)}`);

    // You can query available values for each setting:
    // console.log('Available weights:', client.getAvailableWeights());
    // console.log('Available chains:', client.getAvailableChains());
    // console.log('Available eccentric:', client.getAvailableEccentric());

    // =========================================================================
    // Step 4: Subscribe to telemetry
    // =========================================================================
    console.log('\nStep 4: Setting up telemetry collection...');

    const telemetryData: TelemetryFrame[] = [];
    let frameCount = 0;

    client.onFrame((frame: TelemetryFrame) => {
      frameCount++;
      telemetryData.push(frame);

      // Log every 20th frame to avoid flooding console
      if (frameCount % 20 === 0) {
        console.log(
          `  Frame ${frame.sequence}: ` +
          `pos=${frame.position.toFixed(0).padStart(3)}, ` +
          `vel=${frame.velocity.toFixed(2).padStart(6)}, ` +
          `force=${frame.force.toFixed(0).padStart(4)}, ` +
          `phase=${frame.phase}`
        );
      }
    });

    // =========================================================================
    // Step 5: Start recording (engages motor)
    // =========================================================================
    console.log('\nStep 5: Starting recording...');
    
    // Option A: Simple start (auto-prepares)
    await client.startRecording();
    
    // Option B: Manual prepare for lower latency between sets
    // await client.prepareRecording();  // State: 'preparing' -> 'ready'
    // await client.startRecording();     // State: 'active' (instant)

    console.log('Recording active! Perform some reps.');
    console.log(`Recording state: ${client.recordingState}`);
    console.log('');

    // =========================================================================
    // Step 6: Record workout (10 seconds)
    // =========================================================================
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // =========================================================================
    // Step 7: Stop recording (disengages motor)
    // =========================================================================
    console.log('\nStep 7: Stopping recording...');
    await client.stopRecording();
    console.log(`Recording stopped. State: ${client.recordingState}`);

    // =========================================================================
    // Step 8: Process collected telemetry
    // =========================================================================
    console.log('\nStep 8: Analyzing telemetry data...');
    
    if (telemetryData.length > 0) {
      const positions = telemetryData.map((f) => f.position);
      const velocities = telemetryData.map((f) => Math.abs(f.velocity));
      const forces = telemetryData.map((f) => f.force);

      console.log(`  Total frames: ${telemetryData.length}`);
      console.log(`  Duration: ${((telemetryData[telemetryData.length - 1].timestamp - telemetryData[0].timestamp) / 1000).toFixed(1)}s`);
      console.log(`  Position range: ${Math.min(...positions).toFixed(0)} - ${Math.max(...positions).toFixed(0)}`);
      console.log(`  Peak velocity: ${Math.max(...velocities).toFixed(2)}`);
      console.log(`  Peak force: ${Math.max(...forces).toFixed(0)}`);
      console.log(`  Avg force: ${(forces.reduce((a, b) => a + b, 0) / forces.length).toFixed(0)}`);
    } else {
      console.log('  No telemetry data collected. Was the device moved?');
    }

    // =========================================================================
    // Step 9: Cleanup
    // =========================================================================
    console.log('\nStep 9: Disconnecting...');
    await manager.disconnectAll();
    console.log('Disconnected. Goodbye!');

  } catch (error) {
    console.error('\nError:', error);
    console.error('\nTroubleshooting:');
    console.error('  - Is your Voltra device powered on?');
    console.error('  - Is it connected to another app?');
    console.error('  - Are you within Bluetooth range?');
  } finally {
    manager.dispose();
  }
}

main().catch(console.error);
