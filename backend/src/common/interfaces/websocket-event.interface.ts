// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Event Contracts
// Defines every event shape emitted to the frontend via Socket.io.
// ─────────────────────────────────────────────────────────────────────────────

import type { DockerCrashEvent } from './docker-event.interface.js';
import type { AiRemediationResponse } from './ai-response.interface.js';
import type { QueueHealthMetrics } from './queue-payload.interface.js';
import type { KafkaEventEnvelope } from '../../kafka/kafka.types.js';

/**
 * All possible WebSocket event names.
 */
export enum WsEventName {
  // Infrastructure events
  CONTAINER_CRASH = 'container:crash',
  CONTAINER_RESTART = 'container:restart',
  CONTAINER_STATUS = 'container:status',

  // AI analysis events
  AI_ANALYSIS_START = 'ai:analysis:start',
  AI_ANALYSIS_STREAM = 'ai:analysis:stream',
  AI_ANALYSIS_COMPLETE = 'ai:analysis:complete',
  AI_ANALYSIS_FAILED = 'ai:analysis:failed',

  // Remediation events
  REMEDIATION_EXECUTING = 'remediation:executing',
  REMEDIATION_COMPLETE = 'remediation:complete',
  REMEDIATION_FAILED = 'remediation:failed',

  // System events
  QUEUE_METRICS = 'queue:metrics',
  SYSTEM_HEARTBEAT = 'system:heartbeat',
  TERMINAL_LOG = 'terminal:log',

  // Kafka relay events
  KAFKA_EVENT = 'kafka:event',
  KAFKA_HEALTH = 'kafka:health',
}

/**
 * Container crash broadcast payload.
 */
export interface WsContainerCrashPayload {
  readonly event: DockerCrashEvent;
  readonly serviceId: string | null;
  readonly eventId: string;
  readonly timestamp: string;
}

/**
 * AI analysis streaming chunk (token-by-token from Ollama).
 */
export interface WsAiStreamChunk {
  readonly eventId: string;
  readonly chunk: string;
  readonly isComplete: boolean;
}

/**
 * AI analysis completion payload.
 */
export interface WsAiAnalysisComplete {
  readonly eventId: string;
  readonly planId: string;
  readonly result: AiRemediationResponse;
  readonly processingTimeMs: number;
}

/**
 * Remediation execution payload.
 */
export interface WsRemediationPayload {
  readonly eventId: string;
  readonly planId: string;
  readonly executionId: string;
  readonly action: string;
  readonly success: boolean;
  readonly logs: string;
  readonly timestamp: string;
}

/**
 * Terminal log line for the live terminal overlay.
 */
export interface WsTerminalLog {
  readonly id: string;
  readonly level: 'info' | 'warn' | 'error' | 'debug' | 'ai';
  readonly source: string;
  readonly message: string;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * System heartbeat for connection health.
 */
export interface WsHeartbeat {
  readonly uptime: number;
  readonly connectedClients: number;
  readonly queueMetrics: QueueHealthMetrics;
  readonly timestamp: string;
}

/**
 * Kafka stream event relayed to the dashboard from the backend consumer.
 */
export interface WsKafkaEvent<
  TPayload extends object = Record<string, unknown>,
> {
  readonly topic: string;
  readonly envelope: KafkaEventEnvelope<TPayload>;
  readonly receivedAt: string;
  readonly payloadSummary: string;
}

/**
 * Kafka system health snapshot.
 */
export interface WsKafkaHealth {
  readonly broker: string[];
  readonly producerConnected: boolean;
  readonly consumerGroups: ReadonlyArray<{
    readonly groupId: string;
    readonly connected: boolean;
    readonly topics: readonly string[];
  }>;
  readonly lastPublishedAt: string | null;
  readonly lastConsumedAt: string | null;
  readonly lastError: string | null;
}
