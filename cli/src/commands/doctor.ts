/**
 * Aegis CLI — Doctor command
 *
 * Performs a comprehensive health check of all Aegis infrastructure components:
 * Docker, MongoDB, Kafka, AI Engine, Demo Crash Service, and the NestJS backend.
 */

import { execSync } from 'child_process';
import { log } from '../shared/logger';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';
const AI_ENGINE_URL = process.env.AI_ENGINE_URL ?? 'http://localhost:8000';
const DEMO_URL = process.env.DEMO_CRASH_SERVICE_URL ?? 'http://localhost:3000';

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

async function checkDocker(): Promise<CheckResult> {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    return { name: 'Docker', ok: true, detail: 'Docker daemon is reachable' };
  } catch {
    return { name: 'Docker', ok: false, detail: 'Docker daemon is not running or not accessible' };
  }
}

async function checkMongoDB(): Promise<CheckResult> {
  try {
    const result = execSync(
      "docker exec aegis-mongodb mongosh --quiet --eval \"db.adminCommand('ping').ok\"",
      { stdio: 'pipe', timeout: 10000, encoding: 'utf8' },
    ).trim();
    const ok = result === '1';
    return { name: 'MongoDB', ok, detail: ok ? 'MongoDB is responding to ping' : `Unexpected response: ${result}` };
  } catch {
    return { name: 'MongoDB', ok: false, detail: 'aegis-mongodb container is not running or unreachable' };
  }
}

async function checkKafka(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${BACKEND_URL}/api/orchestrator/health/kafka`, {
        signal: controller.signal,
      });
      const data = await response.json() as Record<string, unknown>;
      const ok = data.status === 'healthy';
      return {
        name: 'Kafka',
        ok,
        detail: ok ? `Kafka broker healthy at ${data.broker}` : `Kafka status: ${data.status ?? 'unknown'}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Fallback: try docker exec
    try {
      execSync(
        'docker exec aegis-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list',
        { stdio: 'pipe', timeout: 10000 },
      );
      return { name: 'Kafka', ok: true, detail: 'Kafka broker is responding (checked via container)' };
    } catch {
      return { name: 'Kafka', ok: false, detail: 'Kafka broker is not reachable' };
    }
  }
}

async function checkService(name: string, url: string, path: string): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${url}${path}`, { signal: controller.signal });
      const ok = response.ok;
      return {
        name,
        ok,
        detail: ok ? `Responding at ${url}${path}` : `HTTP ${response.status} at ${url}${path}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return { name, ok: false, detail: `Not reachable at ${url}${path}` };
  }
}

function printResult(result: CheckResult): void {
  if (result.ok) {
    log.success(`${result.name}: ${result.detail}`);
  } else {
    log.error(`${result.name}: ${result.detail}`);
  }
}

export async function runDoctorCommand(): Promise<void> {
  console.log('');
  console.log('  \x1b[1mAegis Doctor\x1b[0m — Infrastructure Health Check');
  console.log('  ─────────────────────────────────────────────');
  console.log('');

  const checks = await Promise.all([
    checkDocker(),
    checkMongoDB(),
    checkKafka(),
    checkService('NestJS Backend', BACKEND_URL, '/api/health'),
    checkService('AI Engine', AI_ENGINE_URL, '/health'),
    checkService('Demo Crash Service', DEMO_URL, '/health'),
  ]);

  for (const result of checks) {
    printResult(result);
  }

  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;

  console.log('');
  if (passed === total) {
    log.success(`All ${total} checks passed. Aegis is fully operational.`);
  } else {
    log.chaos(`${passed}/${total} checks passed. Some components need attention.`);
    console.log('');
    log.fix('Start infrastructure:  docker compose up -d --build');
    log.fix('Start backend:         npm run start:dev');
  }
  console.log('');
}
