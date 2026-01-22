/**
 * Multi-Device Example
 *
 * Demonstrates connecting to multiple Voltra devices simultaneously
 * using VoltraManager.
 *
 * Usage: npm run multi
 */

import { VoltraManager, NodeBLEAdapter, BLE } from '@voltra/node-sdk';

async function main() {
  console.log('Voltra SDK - Multi-Device Example\n');

  // Create manager with adapter factory
  // Each device gets its own adapter instance
  const manager = new VoltraManager({
    adapterFactory: () => new NodeBLEAdapter({ ble: BLE }),
  });

  // Track frames per device
  const frameCounts = new Map<string, number>();

  // Subscribe to device events
  manager.onDeviceConnected((client, deviceId) => {
    console.log(`\n[${deviceId}] Connected`);
    frameCounts.set(deviceId, 0);

    // Subscribe to frames for this device
    client.onFrame((frame) => {
      const count = (frameCounts.get(deviceId) ?? 0) + 1;
      frameCounts.set(deviceId, count);
      
      if (count % 20 === 0) {
        console.log(`[${deviceId}] Frame ${frame.sequence}: pos=${frame.position.toFixed(0)}`);
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
    devices.forEach((d, i) => console.log(`  ${i + 1}. ${d.name ?? 'Unknown'} (${d.id})`));

    // Connect to all found devices (up to 2)
    const devicesToConnect = devices.slice(0, 2);
    console.log(`\nConnecting to ${devicesToConnect.length} device(s)...`);

    for (const device of devicesToConnect) {
      try {
        await manager.connect(device);
      } catch (error) {
        console.error(`Failed to connect to ${device.id}:`, error);
      }
    }

    console.log(`\nConnected to ${manager.connectedCount} device(s)`);

    // Configure all connected devices
    for (const client of manager.getAllClients()) {
      await client.setWeight(50);
      console.log(`[${client.connectedDeviceId}] Weight set to 50 lbs`);
    }

    // Start recording on all devices
    console.log('\nStarting recording on all devices...');
    for (const client of manager.getAllClients()) {
      await client.startRecording();
    }

    // Record for 10 seconds
    console.log('Recording for 10 seconds...\n');
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Stop recording and show stats
    console.log('\nStopping recording...');
    for (const client of manager.getAllClients()) {
      await client.stopRecording();
      const deviceId = client.connectedDeviceId ?? 'unknown';
      const frames = frameCounts.get(deviceId) ?? 0;
      console.log(`[${deviceId}] Recorded ${frames} frames`);
    }

    // Disconnect all
    await manager.disconnectAll();
    console.log('\nAll devices disconnected. Goodbye!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    manager.dispose();
  }
}

// Run
main().catch(console.error);
