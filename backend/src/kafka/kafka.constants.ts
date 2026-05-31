// ─────────────────────────────────────────────────────────────────────────────
// Kafka Topic, Consumer Group, and Subscription Registry
// All services communicate exclusively through these Kafka topics.
// Direct service-to-service coupling is not allowed.
// ─────────────────────────────────────────────────────────────────────────────

export const KAFKA_TOPICS = {
  CONTAINER_EVENTS: 'aegis.container.events',
  INCIDENT_DETECTED: 'aegis.incident.detected',
  LOGS_EXTRACTED: 'aegis.logs.extracted',
  AI_DIAGNOSIS_COMPLETED: 'aegis.ai.diagnosis.completed',
  REMEDIATION_STARTED: 'aegis.remediation.started',
  REMEDIATION_COMPLETED: 'aegis.remediation.completed',
  AUDIT_EVENTS: 'aegis.audit.events',
  RL_FEEDBACK: 'aegis.rl.feedback',
} as const;

export type KafkaTopic = typeof KAFKA_TOPICS[keyof typeof KAFKA_TOPICS];

/**
 * Consumer groups — each represents an isolated processing boundary.
 * No DASHBOARD group: this is a headless backend platform.
 */
export const KAFKA_CONSUMER_GROUPS = {
  /** Watchman reads container lifecycle events to drive incident detection. */
  WATCHMAN: 'aegis-watchman-group',
  /** Incident service reads container events and extracted logs. */
  INCIDENT: 'aegis-incident-group',
  /** Remediation engine reads started/completed events for post-execution audit. */
  REMEDIATION: 'aegis-remediation-group',
  /** Audit service reads all terminal events for the infrastructure ledger. */
  AUDIT: 'aegis-audit-group',
} as const;

export type KafkaConsumerGroupId = typeof KAFKA_CONSUMER_GROUPS[keyof typeof KAFKA_CONSUMER_GROUPS];

export const KAFKA_CONSUMER_SUBSCRIPTIONS: Record<KafkaConsumerGroupId, readonly KafkaTopic[]> = {
  [KAFKA_CONSUMER_GROUPS.WATCHMAN]: [
    KAFKA_TOPICS.CONTAINER_EVENTS,
    KAFKA_TOPICS.INCIDENT_DETECTED,
  ],
  [KAFKA_CONSUMER_GROUPS.INCIDENT]: [
    KAFKA_TOPICS.CONTAINER_EVENTS,
    KAFKA_TOPICS.INCIDENT_DETECTED,
    KAFKA_TOPICS.LOGS_EXTRACTED,
  ],
  [KAFKA_CONSUMER_GROUPS.REMEDIATION]: [
    KAFKA_TOPICS.REMEDIATION_STARTED,
    KAFKA_TOPICS.REMEDIATION_COMPLETED,
  ],
  [KAFKA_CONSUMER_GROUPS.AUDIT]: [
    KAFKA_TOPICS.AUDIT_EVENTS,
    KAFKA_TOPICS.AI_DIAGNOSIS_COMPLETED,
    KAFKA_TOPICS.REMEDIATION_COMPLETED,
  ],
} as const;

export const KAFKA_SERVICE_NAME = 'aegis-control-plane' as const;