/**
 * Eccentric Semantics Test
 *
 * Determines whether setEccentric(value) sends absolute lbs or a percentage.
 *
 * Setup: base=10 lbs, eccentric=+50, chains=0, inverseChains=0
 * Pull cable and observe eccentric-phase force:
 *   ~60 lbs → eccentric is absolute lbs (10 + 50)
 *   ~15 lbs → eccentric is percentage (10 × 1.5)
 *   ~16 lbs → percentage with 60% firmware cap (10 × 1.6)
 *
 * Usage: npx tsx scripts/test-eccentric.ts
 */

// Import from specific source paths to avoid the NativeBLEAdapter barrel
// export which requires react-native-ble-plx (not available in Node.js)
import { VoltraManager } from '../src/sdk/voltra-manager';
import type { TelemetryFrame } from '../src/voltra/models/telemetry';
import { MovementPhase, PhaseNames } from '../src/voltra/protocol/constants';

const BASE_WEIGHT = 10;
const ECCENTRIC_VALUE = 50;

async function main() {
  console.log('=== Eccentric Semantics Test ===\n');
  console.log(`Base weight: ${BASE_WEIGHT} lbs`);
  console.log(`Eccentric value: +${ECCENTRIC_VALUE}`);
  console.log('');
  console.log('Expected eccentric force:');
  console.log(`  If lbs:        ${BASE_WEIGHT + ECCENTRIC_VALUE} lbs`);
  console.log(`  If percentage:  ${BASE_WEIGHT * (1 + ECCENTRIC_VALUE / 100)} lbs`);
  console.log(`  If % + 60% cap: ${BASE_WEIGHT * 1.6} lbs`);
  console.log('');

  const manager = VoltraManager.forNode();

  try {
    console.log('Scanning for Voltra devices...');
    const devices = await manager.scan({ timeout: 10000 });

    if (devices.length === 0) {
      console.log('No devices found. Is your Voltra powered on?');
      return;
    }

    console.log(`Found: ${devices[0].name ?? devices[0].id}`);
    const client = await manager.connect(devices[0]);
    console.log('Connected!\n');

    console.log('Configuring settings...');
    await client.setWeight(BASE_WEIGHT);
    await client.setChains(0);
    await client.setInverseChains(0);
    await client.setEccentric(ECCENTRIC_VALUE);
    console.log(`Settings: ${JSON.stringify(client.settings)}\n`);

    console.log('Starting recording — pull the cable and release slowly.\n');
    console.log('Phase      | Force (lbs) | Position | Velocity');
    console.log('-----------|-------------|----------|--------');

    client.onFrame((frame: TelemetryFrame) => {
      if (frame.phase === MovementPhase.IDLE) return;

      const phase = (PhaseNames[frame.phase] ?? String(frame.phase)).padEnd(10);
      const force = String(frame.force.toFixed(1)).padStart(11);
      const pos = String(frame.position.toFixed(0)).padStart(8);
      const vel = String(frame.velocity.toFixed(2)).padStart(8);

      console.log(`${phase} |${force} |${pos} |${vel}`);
    });

    await client.startRecording();
    console.log('\nRecording active. Ctrl+C to stop.\n');

    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        console.log('\nStopping...');
        await client.stopRecording();
        await manager.disconnectAll();
        manager.dispose();
        resolve();
      };

      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());
    });
  } catch (error) {
    console.error('Error:', error);
    await manager.disconnectAll();
    manager.dispose();
  }
}

main().catch(console.error);
