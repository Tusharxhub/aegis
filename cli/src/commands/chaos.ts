/**
 * Aegis CLI — Chaos command
 *
 * Triggers controlled failures on the demo-crash-service to test
 * Aegis self-healing detection and remediation pipeline.
 *
 * Supports: oom, timeout, crash
 *
 * Verification strategy:
 *   1. Snapshot the container's StartedAt timestamp BEFORE the crash.
 *   2. Fire the crash request (expect abort/timeout).
 *   3. Wait for Aegis to detect & heal (≈3 s).
 *   4. Re-inspect and compare StartedAt timestamps.
 *   5. Different timestamp + running state = confirmed self-heal.
 */

import { log } from '../shared/logger';
import {
  isDockerAvailable,
  inspectContainer,
  getContainerStartedAt,
} from '../shared/docker';

const DEFAULT_DEMO_URL = 'http://localhost:3000';
const CONTAINER_NAME = 'demo-crash-service';
const HEAL_WAIT_MS = 3000; // time to let Aegis detect + restart

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

/**
 * Detect errors that indicate the target service crashed mid-request.
 * This includes:
 *  - AbortError (our own timeout controller)
 *  - ECONNRESET / socket hang up (classic Node.js)
 *  - UND_ERR_SOCKET / "other side closed" (undici / Node.js built-in fetch)
 */
function isCrashError(error: unknown): boolean {
  if (error instanceof Error) {
    // Direct error properties
    if (
      error.name === 'AbortError' ||
      error.message.includes('aborted') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('socket hang up')
    ) {
      return true;
    }

    // Undici wraps the real error in `cause` — check for SocketError
    const cause = (error as NodeJS.ErrnoException & { cause?: Error }).cause;
    if (cause) {
      const causeMsg = cause.message ?? '';
      const causeName = cause.name ?? '';
      if (
        causeName === 'SocketError' ||
        causeMsg.includes('other side closed') ||
        causeMsg.includes('UND_ERR_SOCKET') ||
        causeMsg.includes('ECONNRESET')
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Detect errors that mean the target service is completely unreachable
 * (i.e. nothing is listening on the port at all).
 */
function isConnectionRefused(error: unknown): boolean {
  if (error instanceof Error) {
    // Check the cause for ECONNREFUSED — undici wraps it
    const cause = (error as NodeJS.ErrnoException & { cause?: Error }).cause;
    if (cause) {
      const causeMsg = cause.message ?? '';
      const causeCode = (cause as NodeJS.ErrnoException).code ?? '';
      if (causeCode === 'ECONNREFUSED' || causeMsg.includes('ECONNREFUSED')) {
        return true;
      }
    }
    // Fallback: direct message match
    if (error.message.includes('ECONNREFUSED')) {
      return true;
    }
  }
  return false;
}

function printNextSteps(): void {
  log.blank();
  log.next('Check Kafka health:');
  log.next('  curl http://localhost:3001/api/orchestrator/health/kafka');
  log.blank();
  log.next('Check container list:');
  log.next('  curl http://localhost:3001/api/orchestrator/containers');
  log.blank();
  log.next('View incidents:');
  log.next('  curl http://localhost:3001/api/orchestrator/incidents');
}

export async function runChaosCommand(args: string[]): Promise<void> {
  const mode = isChaosMode(args[0]) ? args[0] : 'oom';
  const baseUrl = process.env.DEMO_CRASH_SERVICE_URL ?? DEFAULT_DEMO_URL;
  const url = new URL(CHAOS_ENDPOINTS[mode], baseUrl);
  const description = CHAOS_DESCRIPTIONS[mode];

  // ------------------------------------------------------------------
  // Step 0 — Pre-flight: make sure Docker is available
  // ------------------------------------------------------------------
  if (!isDockerAvailable()) {
    log.error('Docker daemon is not reachable.');
    log.fix('Start Docker and try again.');
    return;
  }

  // ------------------------------------------------------------------
  // Step 1 — Snapshot the container BEFORE the crash
  // ------------------------------------------------------------------
  const preStartedAt = getContainerStartedAt(CONTAINER_NAME);
  const preState = inspectContainer(CONTAINER_NAME);

  if (!preState || !preStartedAt) {
    log.error(`Container "${CONTAINER_NAME}" not found.`);
    log.fix(`Run: docker compose up -d ${CONTAINER_NAME}`);
    return;
  }

  if (!preState.running) {
    log.error(`Container "${CONTAINER_NAME}" is not running (state: ${preState.status}).`);
    log.fix(`Run: docker compose up -d ${CONTAINER_NAME}`);
    return;
  }

  log.chaos(`Triggering ${description} on ${CONTAINER_NAME}...`);
  log.chaos(`Target: ${url.toString()}`);
  log.debug(`Pre-crash StartedAt: ${preStartedAt}`);

  // ------------------------------------------------------------------
  // Step 2 — Send the crash request (expect abort / timeout)
  // ------------------------------------------------------------------
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

    if (isCrashError(error)) {
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

  // ------------------------------------------------------------------
  // Step 3 — Wait for the Aegis healing loop
  // ------------------------------------------------------------------
  log.blank();
  log.chaos(`Waiting ${HEAL_WAIT_MS / 1000}s for Aegis to detect and heal...`);
  await new Promise((resolve) => setTimeout(resolve, HEAL_WAIT_MS));

  // ------------------------------------------------------------------
  // Step 4 — Re-inspect the container
  // ------------------------------------------------------------------
  log.chaos('Verifying container state...');

  const postStartedAt = getContainerStartedAt(CONTAINER_NAME);
  const postState = inspectContainer(CONTAINER_NAME);

  if (!postState) {
    log.blank();
    log.verify(`Container "${CONTAINER_NAME}" no longer exists.`);
    log.verify('The crash destroyed the container and it was not recreated.');
    log.fix(`Run: docker compose up -d ${CONTAINER_NAME}`);
    printNextSteps();
    return;
  }

  log.blank();
  log.verify(`Container: ${postState.name}`);
  log.verify(`State:     ${postState.status}${postState.restarting ? ' (restarting)' : ''}`);
  log.verify(`Exit code: ${postState.exitCode}`);
  if (postState.oomKilled) {
    log.verify('OOM Killed: yes');
  }
  if (postState.error) {
    log.verify(`Error: ${postState.error}`);
  }

  log.debug(`Pre-crash  StartedAt: ${preStartedAt}`);
  log.debug(`Post-heal  StartedAt: ${postStartedAt ?? 'N/A'}`);

  // ------------------------------------------------------------------
  // Step 5 — Compare timestamps to determine outcome
  // ------------------------------------------------------------------
  log.blank();

  const timestampChanged = postStartedAt !== null && postStartedAt !== preStartedAt;

  if (timestampChanged && postState.running) {
    // The container died and came back — Aegis healed it!
    log.success('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.success('[AIOps Verified] Container was successfully crashed');
    log.success('and automatically healed by Aegis!');
    log.success('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.blank();
    log.verify('Self-healing pipeline confirmed:');
    log.verify('  → Docker die event detected by Watchman');
    log.verify('  → Container restarted automatically');
    log.verify('  → Kafka event published');
    log.verify('  → Incident stored in MongoDB');
  } else if (timestampChanged && !postState.running) {
    // Container restarted but is currently not running (crashed again?)
    log.chaos('Container was restarted but is no longer running.');
    log.chaos(`Current state: ${postState.status}`);
    log.verify('Aegis detected the crash but the container may have failed again.');
    log.fix(`Check logs: docker logs ${CONTAINER_NAME}`);
  } else if (!timestampChanged && !postState.running) {
    // Container died and was never restarted
    log.chaos('Container crashed and has NOT been restarted.');
    log.verify('Aegis Watchman should detect this Docker event automatically.');
    log.fix(`Manual restart: docker compose up -d ${CONTAINER_NAME}`);
  } else {
    // Timestamp unchanged + still running = crash may not have worked
    log.chaos('Container StartedAt timestamp did not change.');
    log.chaos('The crash endpoint may not have terminated the process,');
    log.chaos('or Aegis has not yet processed the event.');
    log.blank();
    log.fix('Try running the command again, or check:');
    log.fix(`  docker logs ${CONTAINER_NAME} --tail 20`);
    log.fix('  curl http://localhost:3001/api/orchestrator/health/kafka');
  }

  // --- Next steps ---
  printNextSteps();
}