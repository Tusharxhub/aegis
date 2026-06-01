// ─────────────────────────────────────────────────────────────────────────────
// Project Aegis — Application Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default confidence threshold for auto-remediation. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

/** Maximum log lines to extract from a crashed container. */
export const MAX_LOG_LINES = 100;

/** Docker socket reconnection interval in milliseconds. */
export const DOCKER_RECONNECT_INTERVAL_MS = 5000;

/** Maximum Docker socket reconnection attempts before backing off. */
export const DOCKER_MAX_RECONNECT_ATTEMPTS = 50;

/** Containers to ignore when watching for crashes (Aegis infra containers). */
export const IGNORED_CONTAINERS: readonly string[] = [
  'aegis-mongodb',
  'aegis-kafka',
  'aegis-kafka-ui',
  'aegis-ai-engine',
  'aegis-control-plane',
  'aegis-postgres',
  'aegis-redis',
  'aegis-mongo',
] as const;

export const IGNORED_CONTAINERS_SET = new Set<string>(IGNORED_CONTAINERS);

export function isIgnoredContainerName(containerName: string): boolean {
  const normalizedName = containerName.trim().replace(/^\/+/, '');
  return IGNORED_CONTAINERS_SET.has(normalizedName);
}

/** Maximum job retry attempts. */
export const MAX_JOB_ATTEMPTS = 3;

/** Heartbeat interval in milliseconds. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
