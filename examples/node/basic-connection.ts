/**
 * Basic Connection Example
 *
 * Demonstrates the simplified SDK API for connecting to a Voltra device.
 *
 * Usage: npm start
 */

import { VoltraManager, type TelemetryFrame } from '@voltras/node-sdk';

async function main() {
  console.log('Voltra SDK - Node.js Example\n');

  // Create manager - auto-detects platform
  const manager = new VoltraManager();

  try {
    // Option 1: Scan and connect to first device
    console.log('Scanning for Voltra devices...');
    const client = await manager.connectFirst({ timeout: 10000 });

    // Option 2: Connect by name (commented out)
    // const client = await manager.connectByName('VTR-123456');

    console.log(`Connected to ${client.connectedDeviceName ?? client.connectedDeviceId}\n`);

    // Configure device
    console.log('Setting weight to 50 lbs...');
    await client.setWeight(50);

    // Track frames
    let frameCount = 0;

    // Subscribe to telemetry
    client.onFrame((frame: TelemetryFrame) => {
      frameCount++;
      if (frameCount % 10 === 0) {
        console.log(
          `Frame ${frame.sequence}: pos=${frame.position.toFixed(0)}, ` +
          `vel=${frame.velocity.toFixed(2)}, phase=${frame.phase}`
        );
      }
    });

    // Start recording
    console.log('\nStarting recording...');
    await client.startRecording();
    console.log('Recording active. Perform some reps!\n');

    // Record for 10 seconds
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Stop recording
    await client.stopRecording();
    console.log(`\nRecorded ${frameCount} frames`);

    // Cleanup
    await manager.disconnectAll();
    console.log('Disconnected. Goodbye!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    manager.dispose();
  }
}

main().catch(console.error);
