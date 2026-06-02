/**
 * Aegis CLI — Docker inspection utilities
 *
 * Provides container state verification via `docker inspect`.
 * Used by chaos commands to confirm service crash/restart behavior.
 */

import { execSync } from 'child_process';
import { log } from './logger';

export interface ContainerState {
  name: string;
  status: string;
  running: boolean;
  exitCode: number;
  restarting: boolean;
  oomKilled: boolean;
  error: string;
}

/**
 * Check if the Docker daemon is reachable.
 */
export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspect a container by name and return its state.
 * Returns null if the container does not exist.
 */
export function inspectContainer(containerName: string): ContainerState | null {
  try {
    const raw = execSync(
      `docker inspect --format '{{json .State}}' ${containerName}`,
      { stdio: 'pipe', timeout: 5000, encoding: 'utf8' },
    );

    const state = JSON.parse(raw.trim()) as Record<string, unknown>;

    return {
      name: containerName,
      status: String(state.Status ?? 'unknown'),
      running: Boolean(state.Running),
      exitCode: Number(state.ExitCode ?? -1),
      restarting: Boolean(state.Restarting),
      oomKilled: Boolean(state.OOMKilled),
      error: String(state.Error ?? ''),
    };
  } catch {
    return null;
  }
}

/**
 * Print container verification results to the terminal.
 */
export function printContainerVerification(containerName: string): void {
  if (!isDockerAvailable()) {
    log.error('Docker daemon is not reachable.');
    log.fix('Start Docker and try again.');
    return;
  }

  const state = inspectContainer(containerName);

  if (!state) {
    log.verify(`Container "${containerName}" not found.`);
    log.fix(`Run: docker compose up -d ${containerName}`);
    return;
  }

  log.blank();
  log.verify(`Container: ${state.name}`);
  log.verify(`State: ${state.status}${state.restarting ? ' (restarting)' : ''}`);
  log.verify(`Exit code: ${state.exitCode}`);

  if (state.oomKilled) {
    log.verify('OOM Killed: yes');
  }

  if (state.error) {
    log.verify(`Error: ${state.error}`);
  }

  if (state.running && !state.restarting) {
    log.blank();
    log.chaos('Target service is still running. The endpoint may not be producing a real OOM crash.');
  }
}
