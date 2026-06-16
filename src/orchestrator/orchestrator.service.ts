import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DockerService } from '../docker/docker.service.js';
import { AiAgentService, type DiagnoseResponse } from '../ai-agent/ai-agent.service.js';
import { AuditService } from './audit.service.js';
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
 * Kafka-native architecture. No BullMQ, no Redis, no WebSocket.
 * Reacts to Docker crash events via EventEmitter2, performs AI diagnosis,
 * and executes remediation actions with safety checks.
 */
@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly dockerService: DockerService,
    private readonly aiAgent: AiAgentService,
    private readonly auditService: AuditService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  onModuleInit(): void {
    this.logger.log('Orchestrator online — Kafka-native event processing active.');
  }

  /**
   * Main event handler — triggered when a Docker crash event is detected.
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

    try {
      // Step 1: Upsert the service record
      const service = await this.auditService.upsertService(
        event.containerId,
        event.containerName,
        event.imageName,
        ServiceStatus.CRASHED,
        event.exitCode,
      );

      const serviceId = service?._id?.toString() ?? null;

      // Step 2: Log the crash event in the audit ledger
      const eventRecord = await this.auditService.logCrashEvent(
        serviceId ?? event.containerId,
        normalizedEventType,
        event.exitCode,
        event.logs,
        event.metadata,
      );

      const eventId = eventRecord?._id?.toString() ?? correlationId;

      // Step 3: Publish incident detected to Kafka
      await this.kafkaProducer.publish(KAFKA_TOPICS.INCIDENT_DETECTED, {
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

      // Step 4: AI Diagnosis
      this.logger.log(`[${correlationId}] Sending logs to AI Engine for analysis...`);
      const diagnosis = await this.aiAgent.diagnoseLogs(event.logs);

      // Step 5: Persist embedding if available
      if (diagnosis.embedding && diagnosis.embedding.length > 0) {
        await this.auditService.logIncidentEmbedding(
          eventId,
          diagnosis.embedding,
          diagnosis.incidentType,
        );
      }

      // Step 6: Create remediation plan
      const plan = await this.auditService.logRemediationPlan(
        eventId,
        diagnosis.analysis,
        diagnosis.confidenceScore,
        diagnosis.suggestedAction as ActionType,
        diagnosis.riskLevel as RiskLevel,
        diagnosis.reasoning,
      );

      const planId = plan?._id?.toString() ?? correlationId;

      // Step 7: Publish diagnosis result to Kafka
      await this.kafkaProducer.publish(KAFKA_TOPICS.AI_DIAGNOSIS_COMPLETED, {
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

      // Step 8: Execute remediation (with safety checks)
      await this.executeRemediation(event, diagnosis, planId, eventId, correlationId, startTime);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${correlationId}] Orchestration pipeline failed: ${message}`);
    }
  }

  private async executeRemediation(
    event: DockerCrashEvent,
    diagnosis: DiagnoseResponse,
    planId: string,
    eventId: string,
    correlationId: string,
    pipelineStartTime: number,
  ): Promise<void> {
    const action = diagnosis.suggestedAction;
    const confidence = diagnosis.confidenceScore;
    const riskLevel = diagnosis.riskLevel;

    // Safety gate: only execute if confidence meets threshold, risk is LOW, and action is RESTART
    const safetyPassed =
      confidence >= DEFAULT_CONFIDENCE_THRESHOLD &&
      riskLevel === 'LOW' &&
      action === 'RESTART_CONTAINER';

    this.logger.log(
      `[${correlationId}] Safety check: action=${action} confidence=${confidence.toFixed(2)} risk=${riskLevel} pass=${safetyPassed}`,
    );

    // Publish remediation started
    const executionId = randomUUID();
    await this.kafkaProducer.publish(KAFKA_TOPICS.REMEDIATION_STARTED, {
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

    if (!safetyPassed) {
      this.logger.warn(
        `[${correlationId}] Remediation SKIPPED for [${event.containerName}] — safety check failed.`,
      );
      await this.auditService.updatePlanStatus(planId, RemediationStatus.SKIPPED);
      await this.publishRemediationCompleted(event, action, planId, executionId, correlationId, false, 'Safety check failed — remediation skipped', Date.now() - pipelineStartTime);
      return;
    }

    // Execute the action
    const actionStart = Date.now();
    let success = false;
    let executionLogs = '';

    try {
      await this.auditService.updatePlanStatus(planId, RemediationStatus.EXECUTING);

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

    // Persist execution result
    await this.auditService.logActionExecution(
      planId,
      action,
      success,
      executionLogs,
      durationMs,
      success ? undefined : executionLogs,
    );

    await this.auditService.updatePlanStatus(
      planId,
      success ? RemediationStatus.COMPLETED : RemediationStatus.FAILED,
      Date.now() - pipelineStartTime,
    );

    // Update service status
    if (success && action === 'RESTART_CONTAINER') {
      await this.auditService.upsertService(
        event.containerId,
        event.containerName,
        event.imageName,
        ServiceStatus.RESTARTING,
      );
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
    await this.kafkaProducer.publish(KAFKA_TOPICS.REMEDIATION_COMPLETED, {
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
  }
}
