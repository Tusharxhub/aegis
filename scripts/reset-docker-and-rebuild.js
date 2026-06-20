#!/usr/bin/env node

/**
 * reset-docker-and-rebuild.js
 *
 * Safely stops all Aegis containers, removes them, and rebuilds the
 * infrastructure from scratch. Does NOT remove persistent volumes by default.
 *
 * Usage:
 *   node scripts/reset-docker-and-rebuild.js              # Preserve volumes
 *   node scripts/reset-docker-and-rebuild.js --with-volumes  # Remove volumes (destructive)
 */

const { execSync } = require('child_process');
const readline = require('readline');

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const withVolumes = process.argv.includes('--with-volumes');

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

function confirm(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${RED}[WARNING]${RESET} ${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

async function main() {
  console.log('');
  console.log(`  ${BOLD}Project Aegis — Docker Reset & Rebuild${RESET}`);
  console.log('  ─────────────────────────────────────────');
  console.log('');

  if (withVolumes) {
    console.log(`${RED}${BOLD}  DESTRUCTIVE MODE: Volumes will be removed!${RESET}`);
    console.log('');
    const confirmed = await confirm('This will permanently delete all MongoDB data and AI model artifacts. Continue?');
    if (!confirmed) {
      console.log(`${YELLOW}[reset]${RESET} Aborted.`);
      process.exit(0);
    }
  } else {
    console.log(`  ${GREEN}Safe mode:${RESET} Volumes will be preserved.`);
    console.log('');
  }

  // Step 1: Stop all containers
  if (withVolumes) {
    run('docker compose down --remove-orphans -v', 'Stopping all Aegis containers and removing volumes');
  } else {
    run('docker compose down --remove-orphans', 'Stopping all Aegis containers');
  }

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
