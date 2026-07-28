/**
 * Scan Diagnostics
 *
 * Prints what each Node scan backend actually discovers, so a "scan
 * returns nothing" report can be narrowed to a specific layer without
 * guesswork. Connects to nothing and writes nothing to the device.
 *
 * Reports, per backend:
 * - every device the service-UUID filter matched, with its advertised name
 * - which of those would survive a given name-prefix filter
 *
 * Usage:
 *   npx tsx scan-diagnostics.ts                        # node-noble (default)
 *   npx tsx scan-diagnostics.ts --platform node        # legacy webbluetooth
 *   npx tsx scan-diagnostics.ts --prefix VTR-
 *   VOLTRA_DEVICE_NAME_PREFIX=Voltra npx tsx scan-diagnostics.ts
 *
 * Run one backend per invocation. Initializing both native BLE stacks
 * (SimpleBLE via webbluetooth, and noble) in a single process segfaults
 * — observed as exit 139 on macOS 2026-07-28.
 */

import {
  VoltraManager,
  VOLTRA_DEVICE_PREFIX,
  DEVICE_NAME_PREFIX_ENV_VAR,
  resolveDeviceNamePrefix,
  isVoltraDevice,
  type DiscoveredDevice,
} from '@voltras/node-sdk';

const SCAN_TIMEOUT_MS = 10000;

function parsePrefixArg(): string | undefined {
  const index = process.argv.indexOf('--prefix');
  return index === -1 ? undefined : process.argv[index + 1];
}

function parsePlatformArg(): 'node' | 'node-noble' {
  const index = process.argv.indexOf('--platform');
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === 'node' || value === 'node-noble') return value;
  if (value !== undefined) {
    throw new Error(`Unknown --platform "${value}" (expected node or node-noble)`);
  }
  return 'node-noble';
}

function describe(device: DiscoveredDevice, prefix: string | undefined): string {
  const name = device.name ?? '(no advertised name)';
  const verdict = prefix ? (isVoltraDevice(device, prefix) ? 'kept' : 'FILTERED OUT') : 'kept';
  return `  ${name}  [${device.id}]  rssi=${device.rssi ?? 'n/a'}  -> ${verdict}`;
}

async function scanWith(platform: 'node' | 'node-noble', prefix: string | undefined) {
  console.log(`\n--- platform: ${platform} ---`);

  // Scan with name filtering off so we can see everything the
  // service-UUID filter matched, then apply the prefix in reporting.
  const manager = new VoltraManager({ platform, deviceNamePrefix: null });

  try {
    const devices = await manager.scan({ timeout: SCAN_TIMEOUT_MS });

    if (devices.length === 0) {
      console.log('  no devices matched the Voltra service UUID');
      return;
    }

    console.log(`  ${devices.length} device(s) matched the Voltra service UUID:`);
    for (const device of devices) {
      console.log(describe(device, prefix));
    }
  } catch (error) {
    console.log(`  scan failed: ${(error as Error).message}`);
  } finally {
    manager.dispose();
  }
}

async function main() {
  const explicit = parsePrefixArg();
  const prefix = resolveDeviceNamePrefix(explicit);

  console.log('Voltra SDK - Scan Diagnostics\n');
  console.log(`Factory-default name prefix : ${VOLTRA_DEVICE_PREFIX}`);
  console.log(`${DEVICE_NAME_PREFIX_ENV_VAR.padEnd(28)}: ${process.env[DEVICE_NAME_PREFIX_ENV_VAR] ?? '(unset)'}`);
  console.log(`Effective name filter       : ${prefix ?? '(none — service UUID only)'}`);

  await scanWith(parsePlatformArg(), prefix);

  console.log('\nIf a device appears above but your own scan misses it, the');
  console.log('difference is the name filter — see docs/troubleshooting.md.');
}

main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(1);
});
