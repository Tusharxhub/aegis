import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DockerService } from '../docker/docker.service.js';
import { AiAgentService, type DiagnoseResponse } from '../ai-agent/ai-agent.service.js';
import { AuditService } from './audit.service.js';
import { OutboxService } from './outbox.service.js';
import { KafkaProducerService } from '../kafka/kafka.producer.js';
import { KAFKA_TOPICS } from '../kafka/kafka.constants.js';
import { RemediationAction } from '../kafka/kafka.types.js';
import {
  ServiceStatus,
  EventType,
  RemediationStatus,
  ActionType,
  RiskLevel,
} from '../common/interfaces/db-types.js';
import { DEFAULT_CONFIDENCE_THRESHOLD } from '../common/constants/index.js';
import type { DockerCrashEvent } from '../common/interfaces/docker-event.interface.js';

/**
 * OrchestratorService — The Brain of Project Aegis.
 *
 * Kafka-native architecture.
 * Reacts to Docker crash events via EventEmitter2, performs AI diagnosis,
 * and executes remediation actions with safety checks.
 *
 * KEY RESILIENCE PRINCIPLE:
 *   MongoDB persistence is always attempted FIRST and independently of Kafka.
 *   A Kafka outage must never prevent incident storage or audit records.
 *   All Kafka publications go through the durable outbox.
 */
@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly dockerService: DockerService,
    private readonly aiAgent: AiAgentService,
    private readonly auditService: AuditService,
    private readonly outbox: OutboxService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  onModuleInit(): void {
    this.logger.log('Orchestrator online — Kafka-native event processing active.');
  }

  /**
   * Main event handler — triggered when a Docker crash event is detected.
   *
   * MongoDB writes are isolated from Kafka failures. Each secondary operation
   * is wrapped in its own error boundary to prevent cascading failures.
   */
  @OnEvent('docker.crash', { async: true })
  async handleCrashEvent(event: DockerCrashEvent): Promise<void> {
    const correlationId = randomUUID();
    const startTime = Date.now();
    const normalizedEventType: EventType =
      event.eventType === 'health_status'
        ? EventType.HEALTH_CHECK_FAIL
        : (event.eventType.toUpperCase() as EventType);

    this.logger.log(
      `[${correlationId}] Processing crash event for [${event.containerName}] (${event.eventType}, exit: ${event.exitCode})`,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Persist core incident in MongoDB (MUST succeed independently)
    // ─────────────────────────────────────────────────────────────────────────
    let serviceId: string | null = null;
    let eventId: string = correlationId;

    try {
      const service = await this.auditService.upsertService(
        event.containerId,
        event.containerName,
        event.imageName,
        ServiceStatus.CRASHED,
        event.exitCode,
      );
      serviceId = service?._id?.toString() ?? null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${correlationId}] Failed to upsert service in MongoDB: ${message}`);
    }

    try {
      const eventRecord = await this.auditService.logCrashEvent(
        serviceId ?? event.containerId,
        normalizedEventType,
        event.exitCode,
        event.logs,
        event.metadata,
      );
      eventId = eventRecord?._id?.toString() ?? correlationId;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${correlationId}] Failed to persist crash event in MongoDB: ${message}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Publish incident detected via durable outbox
    //         (Kafka failure does NOT block the pipeline)
    // ─────────────────────────────────────────────────────────────────────────
    try {
      await this.outbox.storeAndPublish(KAFKA_TOPICS.INCIDENT_DETECTED, {
        eventType: 'INCIDENT_DETECTED',
        source: 'incident-service',
        correlationId,
        payload: {
          eventId,
          serviceId,
          containerId: event.containerId,
          containerName: event.containerName,
          imageName: event.imageName,
          eventType: normalizedEventType,
          exitCode: event.exitCode,
          detectedAt: event.timestamp.toISOString(),
          logsPreview: event.logs.slice(0, 500),
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${correlationId}] Kafka publish failed for INCIDENT_DETECTED. Incident preserved in outbox for later delivery: ${message}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: AI Diagnosis (with fallback tracking)
    // ─────────────────────────────────────────────────────────────────────────
    this.logger.log(`[${correlationId}] Sending logs to AI Engine for analysis...`);
    const diagnosis = await this.aiAgent.diagnoseLogs(event.logs);

    // Track whether this was a fallback (AI unavailable)
    const isFallbackDiagnosis = diagnosis.aiEngineAvailable === false;

    if (isFallbackDiagnosis) {
      this.logger.warn(`[${correlationId}] AI Engine unavailable — using safe fallback diagnosis. Incident marked for operator review.`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Persist embedding if available (isolated error boundary)
    // ─────────────────────────────────────────────────────────────────────────
    if (diagnosis.embedding && diagnosis.embedding.length > 0) {
      try {
        await this.auditService.logIncidentEmbedding(
          eventId,
          diagnosis.embedding,
          diagnosis.incidentType,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[${correlationId}] Failed to persist embedding: ${message}`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 5: Create remediation plan in MongoDB (isolated error boundary)
    // ─────────────────────────────────────────────────────────────────────────
    let planId: string = correlationId;
    try {
      const plan = await this.auditService.logRemediationPlan(
        eventId,
        diagnosis.analysis,
        diagnosis.confidenceScore,
        diagnosis.suggestedAction as ActionType,
        diagnosis.riskLevel as RiskLevel,
        diagnosis.reasoning,
      );
      planId = plan?._id?.toString() ?? correlationId;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${correlationId}] Failed to persist remediation plan: ${message}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 6: Publish diagnosis result via durable outbox (isolated)
    // ─────────────────────────────────────────────────────────────────────────
    try {
      await this.outbox.storeAndPublish(KAFKA_TOPICS.AI_DIAGNOSIS_COMPLETED, {
        eventType: 'AI_DIAGNOSIS_COMPLETED',
        source: 'ai-engine',
        correlationId,
        payload: {
          eventId,
          planId,
          incidentType: diagnosis.incidentType,
          analysis: diagnosis.analysis,
          confidenceScore: diagnosis.confidenceScore,
          riskLevel: diagnosis.riskLevel as RiskLevel,
          suggestedAction: diagnosis.suggestedAction as RemediationAction,
          reasoning: diagnosis.reasoning,
          similarIncidents: (diagnosis.similarIncidents ?? []).map((s) => ({
            incident_id: s.incident_id,
            label: s.label,
            score: s.score,
          })),
          completedAt: new Date().toISOString(),
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${correlationId}] Kafka publish failed for AI_DIAGNOSIS_COMPLETED. Event preserved in outbox: ${message}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 7: Emit degraded-status event if AI was unavailable
    // ─────────────────────────────────────────────────────────────────────────
    if (isFallbackDiagnosis) {
      try {
        await this.outbox.storeAndPublish(KAFKA_TOPICS.AUDIT_EVENTS, {
          eventType: 'AI_ENGINE_UNAVAILABLE',
          source: 'ai-engine',
          correlationId,
          payload: {
            auditId: randomUUID(),
            entityType: 'incident',
            entityId: eventId,
            action: 'AI_FALLBACK_USED',
            status: 'DEGRADED',
            summary: 'AI engine was unavailable. Fallback diagnosis used. Incident marked for operator review.',
            recordedAt: new Date().toISOString(),
            details: {
              containerName: event.containerName,
              containerId: event.containerId,
              fallbackAction: diagnosis.suggestedAction,
              fallbackConfidence: diagnosis.confidenceScore,
            },
          },
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[${correlationId}] Failed to emit AI degraded-status event: ${message}`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 8: Execute remediation (with safety checks)
    //         Never bypass 0.85 confidence threshold.
    //         Never treat fallback as a successful diagnosis.
    // ─────────────────────────────────────────────────────────────────────────
    await this.executeRemediation(event, diagnosis, planId, eventId, correlationId, startTime, isFallbackDiagnosis);
  }

  private async executeRemediation(
    event: DockerCrashEvent,
    diagnosis: DiagnoseResponse,
    planId: string,
    eventId: string,
    correlationId: string,
    pipelineStartTime: number,
    isFallbackDiagnosis: boolean,
  ): Promise<void> {
    const action = diagnosis.suggestedAction;
    const confidence = diagnosis.confidenceScore;
    const riskLevel = diagnosis.riskLevel;

    // Safety gate: only execute if confidence meets threshold, risk is LOW, and action is RESTART
    // Never bypass the 0.85 safety threshold
    // Never execute remediation on fallback diagnosis
    const safetyPassed =
      !isFallbackDiagnosis &&
      confidence >= DEFAULT_CONFIDENCE_THRESHOLD &&
      riskLevel === 'LOW' &&
      action === 'RESTART_CONTAINER';

    this.logger.log(
      `[${correlationId}] Safety check: action=${action} confidence=${confidence.toFixed(2)} risk=${riskLevel} fallback=${isFallbackDiagnosis} pass=${safetyPassed}`,
    );

    // Publish remediation started via outbox (isolated)
    const executionId = randomUUID();
    try {
      await this.outbox.storeAndPublish(KAFKA_TOPICS.REMEDIATION_STARTED, {
        eventType: 'REMEDIATION_STARTED',
        source: 'remediation-engine',
        correlationId,
        payload: {
          eventId,
          planId,
          executionId,
          containerId: event.containerId,
          containerName: event.containerName,
          action: action as RemediationAction,
          startedAt: new Date().toISOString(),
          safetyPassed,
          confidenceScore: confidence,
          riskLevel: riskLevel as RiskLevel,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${correlationId}] Kafka publish failed for REMEDIATION_STARTED: ${message}`);
    }

    if (!safetyPassed) {
      const skipReason = isFallbackDiagnosis
        ? 'AI engine unavailable — fallback diagnosis cannot trigger remediation'
        : 'Safety check failed — remediation skipped';

      this.logger.warn(
        `[${correlationId}] Remediation SKIPPED for [${event.containerName}] — ${skipReason}.`,
      );

      // Persist skip status (isolated)
      try { await this.auditService.updatePlanStatus(planId, RemediationStatus.SKIPPED); } catch { /* swallow */ }
      await this.publishRemediationCompleted(event, action, planId, executionId, correlationId, false, skipReason, Date.now() - pipelineStartTime);
      return;
    }

    // Execute the action
    const actionStart = Date.now();
    let success = false;
    let executionLogs = '';

    try {
      // Update plan status (isolated)
      try { await this.auditService.updatePlanStatus(planId, RemediationStatus.EXECUTING); } catch { /* swallow */ }

      if (action === 'RESTART_CONTAINER') {
        await this.dockerService.restartContainer(event.containerId);
        executionLogs = `Container [${event.containerName}] restarted successfully.`;
        success = true;
      } else if (action === 'STOP_CONTAINER') {
        executionLogs = `Container [${event.containerName}] — STOP action acknowledged. Manual intervention recommended.`;
        success = true;
      } else {
        executionLogs = `Action ${action} — no automatic remediation performed.`;
        success = true;
      }

      this.logger.log(`[${correlationId}] Remediation ${success ? 'succeeded' : 'failed'} for [${event.containerName}]`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      executionLogs = `Remediation failed: ${message}`;
      this.logger.error(`[${correlationId}] Remediation execution error: ${message}`);
    }

    const durationMs = Date.now() - actionStart;

    // Persist execution result (isolated — each operation independent)
    try {
      await this.auditService.logActionExecution(
        planId,
        action,
        success,
        executionLogs,
        durationMs,
        success ? undefined : executionLogs,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${correlationId}] Failed to persist action execution: ${message}`);
    }

    try {
      await this.auditService.updatePlanStatus(
        planId,
        success ? RemediationStatus.COMPLETED : RemediationStatus.FAILED,
        Date.now() - pipelineStartTime,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${correlationId}] Failed to update plan status: ${message}`);
    }

    // Update service status (isolated)
    if (success && action === 'RESTART_CONTAINER') {
      try {
        await this.auditService.upsertService(
          event.containerId,
          event.containerName,
          event.imageName,
          ServiceStatus.RESTARTING,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[${correlationId}] Failed to update service status: ${message}`);
      }
    }

    await this.publishRemediationCompleted(event, action, planId, executionId, correlationId, success, executionLogs, durationMs);
  }

  private async publishRemediationCompleted(
    event: DockerCrashEvent,
    action: string,
    planId: string,
    executionId: string,
    correlationId: string,
    success: boolean,
    logs: string,
    durationMs: number,
  ): Promise<void> {
    try {
      await this.outbox.storeAndPublish(KAFKA_TOPICS.REMEDIATION_COMPLETED, {
        eventType: 'REMEDIATION_COMPLETED',
        source: 'remediation-engine',
        correlationId,
        payload: {
          eventId: correlationId,
          planId,
          executionId,
          containerId: event.containerId,
          containerName: event.containerName,
          action: action as RemediationAction,
          success,
          logs,
          durationMs,
          completedAt: new Date().toISOString(),
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${correlationId}] Kafka publish failed for REMEDIATION_COMPLETED. Event preserved in outbox: ${message}`);
    }
  }
}
