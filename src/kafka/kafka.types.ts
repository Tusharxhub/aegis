import type { RiskLevel } from '../common/interfaces/db-types.js';
import { KAFKA_TOPICS, type KafkaTopic } from './kafka.constants.js';

export enum RemediationAction {
  RESTART_CONTAINER = 'RESTART_CONTAINER',
  STOP_CONTAINER = 'STOP_CONTAINER',
  IGNORE = 'IGNORE',
}

export type AegisEvent<TPayload = Record<string, unknown>> = {
  readonly eventId: string;
  readonly eventType: string;
  readonly source: KafkaSource;
  readonly timestamp: string;
  readonly correlationId: string;
  readonly payload: TPayload;
};

export type KafkaSource =
  | 'watchman'
  | 'incident-service'
  | 'ai-engine'
  | 'remediation-engine'
  | 'audit-service';

export type KafkaEventEnvelope<TPayload = Record<string, unknown>> =
  AegisEvent<TPayload>;

export interface ContainerEventPayload {
  readonly eventId: string;
  readonly serviceId: string | null;
  readonly containerId: string;
  readonly containerName: string;
  readonly imageName: string;
  readonly action: 'start' | 'die' | 'oom' | 'kill' | 'stop' | 'restart';
  readonly exitCode: number | null;
  readonly detectedAt: string;
  readonly metadata: Record<string, unknown>;
}

export interface IncidentDetectedPayload {
  readonly eventId: string;
  readonly serviceId: string | null;
  readonly containerId: string;
  readonly containerName: string;
  readonly imageName: string;
  readonly eventType: 'DIE' | 'OOM' | 'KILL';
  readonly exitCode: number;
  readonly detectedAt: string;
  readonly logsPreview: string;
}

export interface LogsExtractedPayload {
  readonly eventId: string;
  readonly serviceId: string | null;
  readonly containerId: string;
  readonly containerName: string;
  readonly lineCount: number;
  readonly extractedAt: string;
  readonly logs: string;
}

export interface SimilarIncidentSummary {
  readonly incident_id: string;
  readonly label: string;
  readonly score: number;
}

export interface AiDiagnosisCompletedPayload {
  readonly eventId: string;
  readonly planId: string;
  readonly incidentType: string;
  readonly analysis: string;
  readonly confidenceScore: number;
  readonly riskLevel: RiskLevel;
  readonly suggestedAction: RemediationAction;
  readonly reasoning: string;
  readonly similarIncidents: readonly SimilarIncidentSummary[];
  readonly completedAt: string;
}

export interface RemediationStartedPayload {
  readonly eventId: string;
  readonly planId: string;
  readonly executionId: string;
  readonly containerId: string;
  readonly containerName: string;
  readonly action: RemediationAction;
  readonly startedAt: string;
  readonly safetyPassed: boolean;
  readonly confidenceScore: number;
  readonly riskLevel: RiskLevel;
}

export interface RemediationCompletedPayload {
  readonly eventId: string;
  readonly planId: string;
  readonly executionId: string | null;
  readonly containerId: string;
  readonly containerName: string;
  readonly action: RemediationAction;
  readonly success: boolean;
  readonly logs: string;
  readonly durationMs: number;
  readonly completedAt: string;
}

export interface RlFeedbackPayload {
  readonly feedbackId: string;
  readonly episodeId: string;
  readonly containerId: string;
  readonly containerName: string;
  readonly actionTaken: RemediationAction;
  readonly reward: number;
  readonly isHealthy: boolean;
  readonly stateVectorDim: number;
  readonly recordedAt: string;
}

export interface AuditEventPayload {
  readonly auditId: string;
  readonly entityType:
    | 'service'
    | 'incident'
    | 'plan'
    | 'execution'
    | 'metrics';
  readonly entityId: string;
  readonly action: string;
  readonly status: string;
  readonly summary: string;
  readonly recordedAt: string;
  readonly details: Record<string, unknown>;
}

export interface KafkaTopicPayloadMap {
  [KAFKA_TOPICS.CONTAINER_EVENTS]: ContainerEventPayload;
  [KAFKA_TOPICS.INCIDENT_DETECTED]: IncidentDetectedPayload;
  [KAFKA_TOPICS.LOGS_EXTRACTED]: LogsExtractedPayload;
  [KAFKA_TOPICS.AI_DIAGNOSIS_COMPLETED]: AiDiagnosisCompletedPayload;
  [KAFKA_TOPICS.REMEDIATION_STARTED]: RemediationStartedPayload;
  [KAFKA_TOPICS.REMEDIATION_COMPLETED]: RemediationCompletedPayload;
  [KAFKA_TOPICS.AUDIT_EVENTS]: AuditEventPayload;
  [KAFKA_TOPICS.RL_FEEDBACK]: RlFeedbackPayload;
}

export type KafkaPayloadForTopic<TTopic extends KafkaTopic> =
  KafkaTopicPayloadMap[TTopic];

export interface KafkaPublishContext<TPayload> {
  readonly eventType: string;
  readonly source: KafkaSource;
  readonly payload: TPayload;
  readonly correlationId?: string;
  readonly eventId?: string;
  readonly timestamp?: string;
}

export interface KafkaTopicMessage<TTopic extends KafkaTopic = KafkaTopic> {
  readonly topic: TTopic;
  readonly envelope: KafkaEventEnvelope<KafkaPayloadForTopic<TTopic>>;
  readonly payloadSummary: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.length > 0;
}

function hasNumber(value: Record<string, unknown>, key: string): boolean {
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isFinite(candidate);
}

function normalizeAegisValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const normalized = normalizeAegisValue(entry);
      return normalized === undefined ? null : normalized;
    });
  }
  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const candidate = normalizeAegisValue(value[key]);
      if (candidate !== undefined) normalized[key] = candidate;
    }
    return normalized;
  }
  return '[unserializable value]';
}

export function serializeAegisEvent<TPayload extends Record<string, unknown>>(
  event: AegisEvent<TPayload> | KafkaEventEnvelope<TPayload>,
): string {
  return JSON.stringify(normalizeAegisValue(event));
}

export function isKafkaEventEnvelope(value: unknown): value is KafkaEventEnvelope {
  return isRecord(value) && hasString(value, 'eventId') && hasString(value, 'eventType') && hasString(value, 'source') && hasString(value, 'timestamp') && hasString(value, 'correlationId') && isRecord(value.payload);
}

export function isContainerEventPayload(value: unknown): value is ContainerEventPayload {
  return isRecord(value) && hasString(value, 'eventId') && hasString(value, 'containerId') && hasString(value, 'containerName') && hasString(value, 'imageName') && hasString(value, 'action') && hasString(value, 'detectedAt') && (typeof value.exitCode === 'number' || value.exitCode === null) && isRecord(value.metadata);
}

export function isIncidentDetectedPayload(value: unknown): value is IncidentDetectedPayload {
  return isRecord(value) && hasString(value, 'eventId') && (typeof value.serviceId === 'string' || value.serviceId === null) && hasString(value, 'containerId') && hasString(value, 'containerName') && hasString(value, 'imageName') && hasString(value, 'eventType') && hasNumber(value, 'exitCode') && hasString(value, 'detectedAt') && hasString(value, 'logsPreview');
}

export function isLogsExtractedPayload(value: unknown): value is LogsExtractedPayload {
  return isRecord(value) && hasString(value, 'eventId') && hasString(value, 'containerId') && hasString(value, 'containerName') && hasNumber(value, 'lineCount') && hasString(value, 'extractedAt') && hasString(value, 'logs');
}

export function isAiDiagnosisCompletedPayload(value: unknown): value is AiDiagnosisCompletedPayload {
  return isRecord(value) && hasString(value, 'eventId') && hasString(value, 'planId') && hasString(value, 'incidentType') && hasString(value, 'analysis') && hasNumber(value, 'confidenceScore') && hasString(value, 'riskLevel') && hasString(value, 'suggestedAction') && hasString(value, 'reasoning') && hasString(value, 'completedAt') && Array.isArray(value.similarIncidents);
}

export function isRemediationStartedPayload(value: unknown): value is RemediationStartedPayload {
  return isRecord(value) && hasString(value, 'eventId') && hasString(value, 'planId') && hasString(value, 'executionId') && hasString(value, 'containerId') && hasString(value, 'containerName') && hasString(value, 'action') && hasString(value, 'startedAt') && typeof value.safetyPassed === 'boolean' && hasNumber(value, 'confidenceScore') && hasString(value, 'riskLevel');
}

export function isRemediationCompletedPayload(value: unknown): value is RemediationCompletedPayload {
  return isRecord(value) && hasString(value, 'eventId') && hasString(value, 'planId') && hasString(value, 'containerId') && hasString(value, 'containerName') && hasString(value, 'action') && typeof value.success === 'boolean' && hasString(value, 'logs') && hasNumber(value, 'durationMs') && hasString(value, 'completedAt');
}

export function isRlFeedbackPayload(value: unknown): value is RlFeedbackPayload {
  return isRecord(value) && hasString(value, 'feedbackId') && hasString(value, 'episodeId') && hasString(value, 'containerId') && hasString(value, 'containerName') && hasString(value, 'actionTaken') && hasNumber(value, 'reward') && typeof value.isHealthy === 'boolean' && hasNumber(value, 'stateVectorDim') && hasString(value, 'recordedAt');
}

export function isAuditEventPayload(value: unknown): value is AuditEventPayload {
  return isRecord(value) && hasString(value, 'auditId') && hasString(value, 'entityType') && hasString(value, 'entityId') && hasString(value, 'action') && hasString(value, 'status') && hasString(value, 'summary') && hasString(value, 'recordedAt') && isRecord(value.details);
}

export function isTopicPayload<TTopic extends KafkaTopic>(topic: TTopic, payload: unknown): payload is KafkaPayloadForTopic<TTopic> {
  switch (topic) {
    case KAFKA_TOPICS.CONTAINER_EVENTS: return isContainerEventPayload(payload);
    case KAFKA_TOPICS.INCIDENT_DETECTED: return isIncidentDetectedPayload(payload);
    case KAFKA_TOPICS.LOGS_EXTRACTED: return isLogsExtractedPayload(payload);
    case KAFKA_TOPICS.AI_DIAGNOSIS_COMPLETED: return isAiDiagnosisCompletedPayload(payload);
    case KAFKA_TOPICS.REMEDIATION_STARTED: return isRemediationStartedPayload(payload);
    case KAFKA_TOPICS.REMEDIATION_COMPLETED: return isRemediationCompletedPayload(payload);
    case KAFKA_TOPICS.AUDIT_EVENTS: return isAuditEventPayload(payload);
    case KAFKA_TOPICS.RL_FEEDBACK: return isRlFeedbackPayload(payload);
    default: return false;
  }
}
