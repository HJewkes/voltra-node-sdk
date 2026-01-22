/**
 * Basic Connection Example
 *
 * Demonstrates connecting to a Voltra device, configuring settings,
 * and streaming telemetry data.
 *
 * Usage: npm start
 */

import { VoltraClient, NodeBLEAdapter, BLE, type TelemetryFrame } from '@voltra/node-sdk';

async function main() {
  console.log('Voltra SDK - Node.js Example\n');

  // Create adapter with device chooser
  // The deviceChooser callback lets you programmatically select which device to connect to
  const adapter = new NodeBLEAdapter({
    ble: BLE,
    deviceChooser: (devices) => {
      console.log('Found devices:');
      devices.forEach((d, i) => console.log(`  ${i + 1}. ${d.name ?? 'Unknown'} (${d.id})`));
      // Auto-select first Voltra device
      return devices[0] ?? null;
    },
  });

  // Create client
  const client = new VoltraClient({ adapter });

  // Subscribe to connection state changes
  client.onConnectionStateChange((state) => {
    console.log('Connection state:', state);
  });

  try {
    // Scan for devices
    console.log('\nScanning for Voltra devices...');
    const devices = await client.scan({ timeout: 10000 });

    if (devices.length === 0) {
      console.log('No Voltra devices found. Make sure your device is powered on.');
      return;
    }

    console.log(`Found ${devices.length} device(s)`);

    // Connect to first device
    console.log(`\nConnecting to ${devices[0].name ?? devices[0].id}...`);
    await client.connect(devices[0]);
    console.log('Connected!\n');

    // Configure device settings
    console.log('Configuring device...');
    await client.setWeight(50);  // 50 lbs
    console.log('  Weight: 50 lbs');
    
    // Optional: set chains and eccentric
    // await client.setChains(25);
    // await client.setEccentric(10);

    // Track frames received
    let frameCount = 0;

    // Subscribe to telemetry frames
    const unsubscribe = client.onFrame((frame: TelemetryFrame) => {
      frameCount++;
      // Log every 10th frame to avoid spam
      if (frameCount % 10 === 0) {
        console.log(
          `Frame ${frame.sequence}: pos=${frame.position.toFixed(0)}, ` +
          `vel=${frame.velocity.toFixed(2)}, force=${frame.force.toFixed(0)}, ` +
          `phase=${frame.phase}`
        );
      }
    });

    // Start recording (workout)
    console.log('\nStarting workout recording...');
    await client.startRecording();
    console.log('Recording active. Perform some reps!\n');

    // Record for 10 seconds
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Stop recording
    console.log('\nStopping recording...');
    await client.stopRecording();
    console.log(`Recorded ${frameCount} frames`);

    // Cleanup
    unsubscribe();
    await client.disconnect();
    console.log('\nDisconnected. Goodbye!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.dispose();
  }
}

// Run
main().catch(console.error);
