#!/usr/bin/env node
// src/cli/setup.js
// First-run helper. Verifies configuration and prints guidance for generating
// secrets. Never prints existing secret values. Does not create credentials.

import { loadConfig, generateHexSecret } from '../config.js';

function main() {
  const config = loadConfig();
  const ok = config.problems.length === 0;

  process.stdout.write('HUAN RELAY configuration check\n');
  process.stdout.write('--------------------------------\n');
  process.stdout.write(`NODE_ENV: ${config.nodeEnv}\n`);
  process.stdout.write(`HOST: ${config.host}\n`);
  process.stdout.write(`PORT: ${config.port}\n`);
  process.stdout.write(`DATABASE_PATH: ${config.databasePath}\n`);

  if (config.problems.length) {
    process.stdout.write('\nMissing or invalid configuration:\n');
    for (const p of config.problems) process.stdout.write('  - ' + p + '\n');
  }
  if (config.warnings.length) {
    process.stdout.write('\nWarnings:\n');
    for (const w of config.warnings) process.stdout.write('  - ' + w + '\n');
  }

  process.stdout.write('\nNote: Provider API keys are NOT set here. Enter them in the dashboard after setup.\n');
  process.stdout.write('\nTo generate a new 32-byte hex secret:\n');
  process.stdout.write(`  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\n`);
  process.stdout.write('\nExample value (freshly generated, use your own): ' + generateHexSecret(32) + '\n');

  process.exit(ok ? 0 : 1);
}

main();
