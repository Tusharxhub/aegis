// ─────────────────────────────────────────────────────────────────────────────
// Project Aegis — Application Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default confidence threshold for auto-remediation. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;

/** Maximum log lines to extract from a crashed container. */
export const MAX_LOG_LINES = 100;

/** Docker socket reconnection interval in milliseconds. */
export const DOCKER_RECONNECT_INTERVAL_MS = 5000;

/** Maximum Docker socket reconnection attempts before backing off. */
export const DOCKER_MAX_RECONNECT_ATTEMPTS = 50;

/** Maximum restarts per hour before circuit breaker trips. */
export const MAX_RESTARTS_PER_HOUR = 5;

/** Cooldown period in ms after a remediation attempt before allowing another. */
export const REMEDIATION_COOLDOWN_MS = 60_000;

/** Containers to ignore when watching for crashes (Aegis infra containers). */
export const IGNORED_CONTAINERS: readonly string[] = [
  'aegis-mongodb',
  'aegis-kafka',
  'aegis-kafka-ui',
  'aegis-ai-engine',
  'aegis-control-plane',
] as const;

export const IGNORED_CONTAINERS_SET = new Set<string>(IGNORED_CONTAINERS);

/**
 * Dynamic exclusion list — extended at runtime via env var AEGIS_EXTRA_IGNORED_CONTAINERS.
 * Comma-separated container names.
 */
const extraIgnoredRaw = process.env.AEGIS_EXTRA_IGNORED_CONTAINERS ?? '';
export const DYNAMIC_IGNORED_CONTAINERS: Set<string> = new Set<string>(
  extraIgnoredRaw
    .split(',')
    .map((s) => s.trim().replace(/^\/+/, ''))
    .filter(Boolean),
);

/**
 * Checks if a container should be excluded from monitoring.
 *
 * Rules (in order):
 *   1. Exact match against hardcoded infra list
 *   2. Prefix match: any container starting with "aegis-" is excluded
 *   3. Docker label `aegis.monitor=false` opts out
 *   4. Exact match against dynamic env-var list (AEGIS_EXTRA_IGNORED_CONTAINERS)
 */
export function isIgnoredContainerName(
  containerName: string,
  labels?: Record<string, string>,
): boolean {
  const normalizedName = containerName.trim().replace(/^\/+/, '');

  // 1. Hardcoded infra list
  if (IGNORED_CONTAINERS_SET.has(normalizedName)) return true;

  // 2. Prefix match — all aegis-* infra containers
  if (normalizedName.startsWith('aegis-')) return true;

  // 3. Docker label opt-out
  if (labels?.['aegis.monitor'] === 'false') return true;

  // 4. Dynamic env-var exclusions
  if (DYNAMIC_IGNORED_CONTAINERS.has(normalizedName)) return true;

  return false;
}

/** Maximum job retry attempts. */
export const MAX_JOB_ATTEMPTS = 3;

/** Heartbeat interval in milliseconds. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
