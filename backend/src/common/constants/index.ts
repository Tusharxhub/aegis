// ─────────────────────────────────────────────────────────────────────────────
// Project Aegis — Application Constants
// ─────────────────────────────────────────────────────────────────────────────

/** BullMQ queue name for crash remediation jobs. */
export const REMEDIATION_QUEUE = 'aegis:remediation' as const;

/** BullMQ queue name for telemetry/metrics jobs. */
export const TELEMETRY_QUEUE = 'aegis:telemetry' as const;

/** Socket.io namespace for the control center. */
export const WS_NAMESPACE = '/aegis' as const;

/** Default confidence threshold for auto-remediation. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

/** Maximum log lines to extract from a crashed container. */
export const MAX_LOG_LINES = 100;

/** Docker socket reconnection interval in milliseconds. */
export const DOCKER_RECONNECT_INTERVAL_MS = 5000;

/** Maximum Docker socket reconnection attempts before backing off. */
export const DOCKER_MAX_RECONNECT_ATTEMPTS = 50;

/** Ollama API request timeout in milliseconds. */
export const OLLAMA_REQUEST_TIMEOUT_MS = 120_000;

/** Containers to ignore when watching for crashes (Aegis infra containers). */
export const IGNORED_CONTAINERS: readonly string[] = [
  'aegis-ollama',
  'aegis-mongo',
  'aegis-redis',
  'aegis-rl-brain',
  'aegis-nestjs',
  'aegis-frontend',
] as const;

/** Maximum job retry attempts in BullMQ. */
export const MAX_JOB_ATTEMPTS = 3;

/** Heartbeat interval in milliseconds. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
