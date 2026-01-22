/**
 * Multi-Device Example
 *
 * Demonstrates connecting to multiple Voltra devices.
 *
 * Usage: npm run multi
 */

import { VoltraManager } from '@voltra/node-sdk';

async function main() {
  console.log('Voltra SDK - Multi-Device Example\n');

  // Create manager
  const manager = new VoltraManager();

  // Track frames per device
  const frameCounts = new Map<string, number>();

  // Listen for device events
  manager.onDeviceConnected((client, deviceId, deviceName) => {
    console.log(`[${deviceName ?? deviceId}] Connected`);
    frameCounts.set(deviceId, 0);

    client.onFrame((frame) => {
      const count = (frameCounts.get(deviceId) ?? 0) + 1;
      frameCounts.set(deviceId, count);
      
      if (count % 20 === 0) {
        console.log(`[${deviceName ?? deviceId}] Frame ${frame.sequence}: pos=${frame.position.toFixed(0)}`);
      }
    });
  });

  manager.onDeviceDisconnected((deviceId) => {
    console.log(`[${deviceId}] Disconnected`);
    frameCounts.delete(deviceId);
  });

  try {
    // Scan for devices
    console.log('Scanning for Voltra devices...');
    const devices = await manager.scan({ timeout: 10000 });

    if (devices.length === 0) {
      console.log('No Voltra devices found.');
      return;
    }

    console.log(`Found ${devices.length} device(s):`);
    devices.forEach((d, i) => console.log(`  ${i + 1}. ${d.name ?? 'Unknown'}`));

    // Connect to up to 2 devices
    const devicesToConnect = devices.slice(0, 2);
    console.log(`\nConnecting to ${devicesToConnect.length} device(s)...`);

    for (const device of devicesToConnect) {
      try {
        await manager.connect(device);
      } catch (error) {
        console.error(`Failed to connect to ${device.name}:`, error);
      }
    }

    // Configure all devices
    for (const client of manager.getAllClients()) {
      await client.setWeight(50);
      console.log(`[${client.connectedDeviceName}] Weight set to 50 lbs`);
    }

    // Start recording on all
    console.log('\nStarting recording...');
    for (const client of manager.getAllClients()) {
      await client.startRecording();
    }

    // Record for 10 seconds
    console.log('Recording for 10 seconds...\n');
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Stop and show stats
    console.log('\nStopping recording...');
    for (const client of manager.getAllClients()) {
      await client.stopRecording();
      const deviceId = client.connectedDeviceId ?? 'unknown';
      const frames = frameCounts.get(deviceId) ?? 0;
      console.log(`[${client.connectedDeviceName}] Recorded ${frames} frames`);
    }

    await manager.disconnectAll();
    console.log('\nAll devices disconnected. Goodbye!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    manager.dispose();
  }
}

main().catch(console.error);
