// ─────────────────────────────────────────────────────────────────────────────
// Operational Event Contracts
// Defines every event shape used by the headless control plane.
// ─────────────────────────────────────────────────────────────────────────────

import type { DockerCrashEvent } from './docker-event.interface.js';
import type { AiRemediationResponse } from './ai-response.interface.js';
import type { QueueHealthMetrics } from './queue-payload.interface.js';
import type { KafkaEventEnvelope } from '../../kafka/kafka.types.js';

/**
 * All possible operational event names.
 */
export enum OperationalEventName {
  CONTAINER_CRASH = 'container:crash',
  CONTAINER_RESTART = 'container:restart',
  CONTAINER_STATUS = 'container:status',
  AI_ANALYSIS_START = 'ai:analysis:start',
  AI_ANALYSIS_STREAM = 'ai:analysis:stream',
  AI_ANALYSIS_COMPLETE = 'ai:analysis:complete',
  AI_ANALYSIS_FAILED = 'ai:analysis:failed',
  REMEDIATION_EXECUTING = 'remediation:executing',
  REMEDIATION_COMPLETE = 'remediation:complete',
  REMEDIATION_FAILED = 'remediation:failed',
  QUEUE_METRICS = 'queue:metrics',
  SYSTEM_HEARTBEAT = 'system:heartbeat',
  TERMINAL_LOG = 'terminal:log',
  KAFKA_EVENT = 'kafka:event',
  KAFKA_HEALTH = 'kafka:health',
}

export interface OperationalContainerCrashPayload {
  readonly event: DockerCrashEvent;
  readonly serviceId: string | null;
  readonly eventId: string;
  readonly timestamp: string;
}

export interface OperationalAiStreamChunk {
  readonly eventId: string;
  readonly chunk: string;
  readonly isComplete: boolean;
}

export interface OperationalAiAnalysisComplete {
  readonly eventId: string;
  readonly planId: string;
  readonly result: AiRemediationResponse;
  readonly processingTimeMs: number;
}

export interface OperationalRemediationPayload {
  readonly eventId: string;
  readonly planId: string;
  readonly executionId: string;
  readonly action: string;
  readonly success: boolean;
  readonly logs: string;
  readonly timestamp: string;
}

export interface OperationalTerminalLog {
  readonly id: string;
  readonly level: 'info' | 'warn' | 'error' | 'debug' | 'ai';
  readonly source: string;
  readonly message: string;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}

export interface OperationalHeartbeat {
  readonly uptime: number;
  readonly connectedClients: number;
  readonly queueMetrics: QueueHealthMetrics;
  readonly timestamp: string;
}

export interface OperationalKafkaEvent<
  TPayload extends object = Record<string, unknown>,
> {
  readonly topic: string;
  readonly envelope: KafkaEventEnvelope<TPayload>;
  readonly receivedAt: string;
  readonly payloadSummary: string;
}

export interface OperationalKafkaHealth {
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