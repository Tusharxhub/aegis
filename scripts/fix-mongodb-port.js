#!/usr/bin/env node

/**
 * fix-mongodb-port.js
 *
 * Detects if MongoDB port 27017 is already occupied by another process.
 * If a conflict is found, reports the PID and provides instructions.
 *
 * Usage: node scripts/fix-mongodb-port.js
 */

const { execSync } = require('child_process');
const net = require('net');

const PORT = 27017;

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true); // port is in use
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false); // port is free
    });
    server.listen(port, '127.0.0.1');
  });
}

async function main() {
  console.log(`[fix-mongodb-port] Checking port ${PORT}...`);

  const inUse = await checkPort(PORT);

  if (!inUse) {
    console.log(`[fix-mongodb-port] ✓ Port ${PORT} is available. No conflict detected.`);
    process.exit(0);
  }

  console.log(`[fix-mongodb-port] ✗ Port ${PORT} is already in use.`);

  // Try to find what's using it
  try {
    const platform = process.platform;
    let cmd;
    if (platform === 'linux' || platform === 'darwin') {
      cmd = `lsof -i :${PORT} -t 2>/dev/null || ss -tlnp 'sport = :${PORT}' 2>/dev/null`;
    } else {
      cmd = `netstat -ano | findstr :${PORT}`;
    }

    const output = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
    if (output) {
      console.log(`[fix-mongodb-port] Process(es) using port ${PORT}:`);
      console.log(`  ${output}`);
    }
  } catch {
    console.log(`[fix-mongodb-port] Could not determine which process is using the port.`);
  }

  console.log('');
  console.log('[fix-mongodb-port] To fix:');
  console.log('  1. Stop the conflicting process');
  console.log('  2. Or change the MongoDB port in docker-compose.yml');
  console.log('  3. Then run: docker compose up -d aegis-mongodb');
  process.exit(1);
}

main();
