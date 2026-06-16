export enum ServiceStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  CRASHED = 'CRASHED',
  RESTARTING = 'RESTARTING',
  UNKNOWN = 'UNKNOWN',
}

export enum EventType {
  DIE = 'DIE',
  OOM = 'OOM',
  KILL = 'KILL',
  HEALTH_CHECK_FAIL = 'HEALTH_CHECK_FAIL',
}

export enum RemediationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  EXECUTING = 'EXECUTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export enum ActionType {
  RESTART_CONTAINER = 'RESTART_CONTAINER',
  STOP_CONTAINER = 'STOP_CONTAINER',
  IGNORE = 'IGNORE',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}
