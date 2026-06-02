/**
 * Aegis CLI — Chaos command
 *
 * Triggers controlled failures on the demo-crash-service to test
 * Aegis self-healing detection and remediation pipeline.
 *
 * Supports: oom, timeout, crash
 */

import { log } from '../shared/logger';
import { isDockerAvailable, printContainerVerification } from '../shared/docker';

const DEFAULT_DEMO_URL = 'http://localhost:3000';
const CONTAINER_NAME = 'demo-crash-service';

type ChaosMode = 'oom' | 'timeout' | 'crash';

const CHAOS_ENDPOINTS: Record<ChaosMode, string> = {
  oom: '/crash/oom',
  timeout: '/crash/timeout',
  crash: '/crash',
};

const CHAOS_DESCRIPTIONS: Record<ChaosMode, string> = {
  oom: 'OOM crash',
  timeout: 'timeout hang',
  crash: 'process crash',
};

function isChaosMode(value: string | undefined): value is ChaosMode {
  return value === 'oom' || value === 'timeout' || value === 'crash';
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === 'AbortError' ||
      error.message.includes('aborted') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('socket hang up')
    );
  }
  return false;
}

function isConnectionRefused(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('fetch failed')
    );
  }
  return false;
}

function printNextSteps(): void {
  log.blank();
  log.next('Watch the Aegis backend logs for crash detection.');
  log.next('  → container die event');
  log.next('  → logs extracted');
  log.next('  → Kafka event published');
  log.next('  → incident stored in MongoDB');
  log.blank();
  log.next('Check Kafka health:');
  log.next('  curl http://localhost:3001/api/orchestrator/health/kafka');
  log.blank();
  log.next('Check container list:');
  log.next('  curl http://localhost:3001/api/orchestrator/containers');
  log.blank();
  log.next(`Restart target: docker compose up -d ${CONTAINER_NAME}`);
}

export async function runChaosCommand(args: string[]): Promise<void> {
  const mode = isChaosMode(args[0]) ? args[0] : 'oom';
  const baseUrl = process.env.DEMO_CRASH_SERVICE_URL ?? DEFAULT_DEMO_URL;
  const url = new URL(CHAOS_ENDPOINTS[mode], baseUrl);
  const description = CHAOS_DESCRIPTIONS[mode];

  log.chaos(`Triggering ${description} on ${CONTAINER_NAME}...`);
  log.chaos(`Target: ${url.toString()}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
    });

    const body = await response.text().catch(() => '');

    if (response.ok) {
      log.chaos(`Response ${response.status}: ${body || 'OK'}`);
      log.chaos(`The ${description} endpoint responded before termination.`);
    } else {
      log.chaos(`Response ${response.status}: ${body || '(empty)'}`);
    }
  } catch (error: unknown) {
    if (isConnectionRefused(error)) {
      log.blank();
      log.error(`Demo crash service is not reachable at ${baseUrl}`);
      log.fix(`Run: docker compose up -d ${CONTAINER_NAME}`);
      return;
    }

    if (isAbortError(error)) {
      log.chaos('Request aborted because the target service terminated.');
      log.chaos(`This is expected for a${mode === 'oom' ? 'n' : ''} ${description} chaos test.`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      log.chaos(`Request terminated: ${message}`);
      log.chaos(`This is likely expected for a ${description} chaos test.`);

      log.debug(error instanceof Error && error.stack ? error.stack : String(error));
    }
  } finally {
    clearTimeout(timeout);
  }

  // --- Container verification ---
  log.blank();
  log.chaos('Verifying container state...');

  if (!isDockerAvailable()) {
    log.error('Docker daemon is not reachable.');
    log.fix('Start Docker and try again.');
    return;
  }

  // Wait a moment for the container to transition state
  await new Promise((resolve) => setTimeout(resolve, 2000));

  printContainerVerification(CONTAINER_NAME);

  log.blank();
  log.verify('Aegis Watchman should detect this Docker event automatically.');

  // --- Next steps ---
  printNextSteps();
}