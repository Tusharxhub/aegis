#!/usr/bin/env node

/**
 * verify-runtime.js
 *
 * Verifies that all Project Aegis infrastructure components are online
 * and responsive. Prints a clean pass/fail report.
 *
 * Usage: node scripts/verify-runtime.js
 *
 * Checks: Docker, MongoDB, Kafka, AI Engine, Demo Crash Service, NestJS Backend
 */

const { execSync } = require('child_process');
const http = require('http');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000';
const DEMO_URL = process.env.DEMO_CRASH_SERVICE_URL || 'http://localhost:3000';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: data });
        });
      });
      req.on('error', () => resolve({ ok: false, status: 0, body: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: '' }); });
    } catch {
      resolve({ ok: false, status: 0, body: '' });
    }
  });
}

function execCheck(cmd, timeoutMs = 5000) {
  try {
    execSync(cmd, { stdio: 'pipe', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('');
  console.log(`  ${BOLD}Project Aegis — Runtime Verification${RESET}`);
  console.log('  ─────────────────────────────────────────');
  console.log('');

  const results = [];

  // Docker
  const dockerOk = execCheck('docker info');
  results.push({ name: 'Docker Socket', ok: dockerOk });

  // MongoDB
  const mongoOk = execCheck("docker exec aegis-mongodb mongosh --quiet --eval \"db.adminCommand('ping').ok\"", 10000);
  results.push({ name: 'MongoDB', ok: mongoOk });

  // Kafka
  const kafkaResult = await httpGet(`${BACKEND_URL}/api/orchestrator/health/kafka`);
  let kafkaOk = false;
  if (kafkaResult.ok) {
    try {
      const data = JSON.parse(kafkaResult.body);
      kafkaOk = data.status === 'healthy';
    } catch { /* ignore */ }
  }
  if (!kafkaOk) {
    kafkaOk = execCheck('docker exec aegis-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list', 10000);
  }
  results.push({ name: 'Kafka Broker', ok: kafkaOk });

  // NestJS Backend
  const backendResult = await httpGet(`${BACKEND_URL}/api/health`);
  results.push({ name: 'NestJS Backend', ok: backendResult.ok });

  // AI Engine
  const aiResult = await httpGet(`${AI_ENGINE_URL}/health`);
  results.push({ name: 'AI Engine', ok: aiResult.ok });

  // Demo Crash Service
  const demoResult = await httpGet(`${DEMO_URL}/health`);
  results.push({ name: 'Demo Crash Service', ok: demoResult.ok });

  // Print results
  for (const r of results) {
    const icon = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const label = r.ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    console.log(`  ${icon} ${r.name.padEnd(22)} ${label}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;

  console.log('');
  if (passed === total) {
    console.log(`  ${GREEN}${BOLD}All ${total} checks passed. Aegis is fully operational.${RESET}`);
  } else {
    console.log(`  ${RED}${BOLD}${passed}/${total} checks passed.${RESET}`);
    console.log('');
    console.log('  Fix suggestions:');
    console.log('    docker compose up -d --build');
    console.log('    npm run start:dev');
  }
  console.log('');

  process.exit(passed === total ? 0 : 1);
}

main();
