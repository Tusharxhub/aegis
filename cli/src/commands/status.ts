/**
 * Aegis CLI — Status command
 *
 * Displays a comprehensive snapshot of the Aegis platform state:
 * running containers, recent incidents, Kafka health, and AI engine status.
 */

import { log } from '../shared/logger';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

export async function runStatusCommand(): Promise<void> {
  console.log('');
  console.log('  \x1b[1mAegis Status\x1b[0m — Platform Snapshot');
  console.log('  ─────────────────────────────────────────');
  console.log('');

  // Backend health
  const health = await fetchJson(`${BACKEND_URL}/api/health`);
  if (!health) {
    log.error('NestJS backend is not reachable at ' + BACKEND_URL);
    log.fix('Start the backend: npm run start:dev');
    return;
  }

  log.success(`Backend: ${health.status} | Uptime: ${health.uptime}s`);

  // Kafka health
  const kafka = await fetchJson(`${BACKEND_URL}/api/orchestrator/health/kafka`);
  if (kafka) {
    const status = kafka.status === 'healthy' ? '✓ healthy' : '⚠ degraded';
    log.verify(`Kafka: ${status} | Broker: ${kafka.broker ?? 'unknown'}`);
  } else {
    log.error('Kafka health check failed');
  }

  // Containers
  const containers = await fetchJson(`${BACKEND_URL}/api/orchestrator/containers`);
  if (containers && Array.isArray(containers.containers)) {
    console.log('');
    log.verify(`Docker containers: ${containers.count}`);
    for (const c of containers.containers as Array<Record<string, unknown>>) {
      const names = Array.isArray(c.names) ? (c.names as string[]).join(', ') : String(c.names ?? '');
      const state = String(c.state ?? 'unknown');
      const icon = state === 'running' ? '●' : '○';
      console.log(`    ${icon} ${names} [${state}] ${c.status ?? ''}`);
    }
  }

  // Recent incidents
  const incidents = await fetchJson(`${BACKEND_URL}/api/orchestrator/incidents`);
  if (incidents && Array.isArray(incidents.incidents) && (incidents.incidents as unknown[]).length > 0) {
    console.log('');
    log.verify(`Recent incidents: ${incidents.count}`);
    const recent = (incidents.incidents as Array<Record<string, unknown>>).slice(0, 5);
    for (const inc of recent) {
      const ts = inc.timestamp ? new Date(inc.timestamp as string).toLocaleTimeString() : 'unknown';
      console.log(`    → [${inc.eventType}] at ${ts} | exit: ${inc.exitCode ?? 'n/a'}`);
    }
  } else {
    console.log('');
    log.verify('No recent incidents recorded.');
  }

  // Recent remediations
  const remediations = await fetchJson(`${BACKEND_URL}/api/orchestrator/remediations`);
  if (remediations && Array.isArray(remediations.remediations) && (remediations.remediations as unknown[]).length > 0) {
    console.log('');
    log.verify(`Recent remediations: ${remediations.count}`);
    const recent = (remediations.remediations as Array<Record<string, unknown>>).slice(0, 5);
    for (const rem of recent) {
      const action = rem.suggestedAction ?? 'unknown';
      const status = rem.status ?? 'unknown';
      const confidence = typeof rem.confidenceScore === 'number' ? (rem.confidenceScore as number).toFixed(2) : 'n/a';
      console.log(`    → [${action}] status: ${status} | confidence: ${confidence} | risk: ${rem.riskLevel ?? 'n/a'}`);
    }
  }

  console.log('');
}
