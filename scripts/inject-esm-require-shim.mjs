#!/usr/bin/env node
/**
 * Inject a `createRequire` shim into ESM-built files that use
 * CommonJS-style `require()` calls.
 *
 * Why: `voltra-manager.ts` lazy-loads platform-specific BLE adapters
 * (web/node/native/mock) via `require()` so that consumers don't eagerly
 * resolve peer dependencies (webbluetooth, node-ble-plx,
 * react-native-ble-plx) they don't need. The TypeScript source emits
 * literal `require(...)` calls into the ESM output, where stock Node ESM
 * has no `require` global -- calls would throw "require is not defined".
 *
 * This script prepends a small banner that synthesizes `require` from
 * `createRequire(import.meta.url)`. CJS output is left untouched (the
 * native CJS `require` is fine there).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGETS = [
  // Add additional ESM files here if they emit literal require() calls.
  'dist/esm/sdk/voltra-manager.js',
];

const BANNER =
  "import { createRequire as __voltrasCreateRequire } from 'node:module';\n" +
  'const require = __voltrasCreateRequire(import.meta.url);\n';

const cwd = process.cwd();

for (const rel of TARGETS) {
  const path = resolve(cwd, rel);
  const original = readFileSync(path, 'utf8');
  if (original.includes('__voltrasCreateRequire')) {
    // Idempotent: already injected.
    continue;
  }
  writeFileSync(path, BANNER + original);
  process.stdout.write(`injected createRequire shim into ${rel}\n`);
}
