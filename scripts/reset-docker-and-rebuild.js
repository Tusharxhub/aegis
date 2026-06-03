#!/usr/bin/env node

/**
 * reset-docker-and-rebuild.js
 *
 * Safely stops all Aegis containers, removes them, and rebuilds the
 * infrastructure from scratch. Does NOT remove persistent volumes.
 *
 * Usage: node scripts/reset-docker-and-rebuild.js
 */

const { execSync } = require('child_process');

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function run(cmd, label) {
  console.log(`${YELLOW}[reset]${RESET} ${label}...`);
  try {
    execSync(cmd, { stdio: 'inherit', timeout: 120000 });
    return true;
  } catch (err) {
    console.log(`${YELLOW}[reset]${RESET} Warning: ${label} had issues (may be expected).`);
    return false;
  }
}

async function main() {
  console.log('');
  console.log(`  ${BOLD}Project Aegis — Docker Reset & Rebuild${RESET}`);
  console.log('  ─────────────────────────────────────────');
  console.log('');

  // Step 1: Stop all containers
  run('docker compose down --remove-orphans', 'Stopping all Aegis containers');

  // Step 2: Remove dangling images (optional cleanup)
  run('docker image prune -f', 'Pruning dangling images');

  // Step 3: Rebuild and start
  run('docker compose up -d --build', 'Rebuilding and starting all services');

  console.log('');
  console.log(`${GREEN}[reset]${RESET} ✓ Reset complete.`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Wait for services to initialize:');
  console.log('       node scripts/wait-for-kafka.js');
  console.log('    2. Start the NestJS backend:');
  console.log('       npm run start:dev');
  console.log('    3. Verify everything:');
  console.log('       node scripts/verify-runtime.js');
  console.log('');
}

main();
