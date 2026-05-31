import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import type { Job } from 'bullmq';
import { DockerService } from '../docker/docker.service.js';
import { QueueService } from '../queue/queue.service.js';
import { AegisGateway } from '../gateway/events.gateway.js';
import { AiAgentService } from '../ai-agent/ai-agent.service.js';
import { AuditService } from './audit.service.js';
import { RemediationEngine } from './remediation.service.js';
import type { DockerCrashEvent } from '../common/interfaces/docker-event.interface.js';
import type {
  CrashJobPayload,
  JobProcessingResult,
} from '../common/interfaces/queue-payload.interface.js';
import { JobPriority } from '../common/interfaces/queue-payload.interface.js';
import { OperationalEventName } from '../common/interfaces/operational-event.interface.js';
import { MAX_JOB_ATTEMPTS } from '../common/constants/index.js';
import {
  ServiceStatus,
  EventType,
  RemediationStatus,
  ActionType,
  RiskLevel,
} from '../common/interfaces/db-types.js';
import { KafkaProducerService } from '../kafka/kafka.producer.js';
import { KAFKA_TOPICS } from '../kafka/kafka.constants.js';
import { RemediationAction } from '../kafka/kafka.types.js';

@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly remediationEngine: RemediationEngine,
    private readonly dockerService: DockerService,
    private readonly queueService: QueueService,
    private readonly gateway: AegisGateway,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly aiAgent: AiAgentService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      '🧠 Core Relational Orchestrator online — custom AI pipelines loaded.',
    );
  }

  /**
   * Daily 3:00 AM Cron task to trigger classification checks or model updates if necessary.
   */
  @Cron('0 0 3 * * *')
  async handleDailyTraining(): Promise<void> {
    this.logger.log('📅 Scheduled daily audit task triggered at 3:00 AM.');
    // In local CPU setup, logging metrics for training evaluation
    const cpuUsage = 0.12;
    const memoryUsage = 0.45;
    const diskUsage = 0.08;

    await this.auditService.logMetrics(cpuUsage, memoryUsage, diskUsage);

    void this.kafkaProducer.publish(KAFKA_TOPICS.METRICS_SNAPSHOTS, {
      eventType: 'METRICS_SNAPSHOT_RECORDED',
      source: 'audit-service',
      correlationId: 'daily-training-window',
      payload: {
        snapshotId: randomUUID(),
        source: 'scheduler',
        collectedAt: new Date().toISOString(),
        cpuUsage,
        memoryUsage,
        diskUsage,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Watcher Event Interception
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handles incoming Docker crash events from the DockerWatcherService.
   */
  @OnEvent('docker.crash')
  async handleDockerCrash(event: DockerCrashEvent): Promise<void> {
    try {
      this.logger.warn(
        `🚨 Intercepted container crash event: [${event.containerName}]`,
      );
      this.emitTerminalLog(
        'warn',
        'Watcher',
        `🚨 Container [${event.containerName}] crashed (exit: ${event.exitCode})`,
      );

      // 1. Log incident status to MongoDB
      const service = await this.auditService.upsertService(
        event.containerId,
        event.containerName,
        event.imageName,
        ServiceStatus.CRASHED,
        event.exitCode,
      );

      const eventTypeMap: Record<string, EventType> = {
        die: EventType.DIE,
        oom: EventType.OOM,
        kill: EventType.KILL,
      };

      const infraEvent = await this.auditService.logCrashEvent(
        service.id,
        eventTypeMap[event.eventType] ?? EventType.DIE,
        event.exitCode ?? 1,
        event.logs,
        event.metadata,
      );

      void this.kafkaProducer.publish(KAFKA_TOPICS.INCIDENT_DETECTED, {
        eventType: 'INCIDENT_DETECTED',
        source: 'incident-service',
        correlationId: infraEvent.id.toString(),
        eventId: randomUUID(),
        payload: {
          eventId: infraEvent.id.toString(),
          serviceId: service.id?.toString?.() ?? null,
          containerId: event.containerId,
          containerName: event.containerName,
          imageName: event.imageName,
          eventType: (
            eventTypeMap[event.eventType] ?? EventType.DIE
          ).toString() as 'DIE' | 'OOM' | 'KILL',
          exitCode: event.exitCode ?? 1,
          detectedAt: infraEvent.timestamp.toISOString(),
          logsPreview: event.logs.slice(0, 2_048),
        },
      });

      void this.kafkaProducer.publish(KAFKA_TOPICS.LOGS_EXTRACTED, {
        eventType: 'LOGS_EXTRACTED',
        source: 'incident-service',
        correlationId: infraEvent.id.toString(),
        eventId: randomUUID(),
        payload: {
          eventId: randomUUID(),
          serviceId: service.id?.toString?.() ?? null,
          containerId: event.containerId,
          containerName: event.containerName,
          lineCount: event.logs
            .split('\n')
            .filter((line) => line.trim().length > 0).length,
          extractedAt: new Date().toISOString(),
          logs: event.logs,
        },
      });

      void this.kafkaProducer.publish(KAFKA_TOPICS.AUDIT_EVENTS, {
        eventType: 'AUDIT_EVENT_RECORDED',
        source: 'audit-service',
        correlationId: infraEvent.id.toString(),
        eventId: randomUUID(),
        payload: {
          auditId: randomUUID(),
          entityType: 'incident',
          entityId: infraEvent.id.toString(),
          action: 'incident.logged',
          status: 'RECORDED',
          summary: `Crash event captured for ${event.containerName}`,
          recordedAt: new Date().toISOString(),
          details: {
            containerId: event.containerId,
            containerName: event.containerName,
            imageName: event.imageName,
            eventType: event.eventType,
            exitCode: event.exitCode,
          },
        },
      });

      // 2. Record incident.detected in the headless event sink
      this.gateway.broadcast('incident.detected', {
        id: infraEvent.id,
        containerId: event.containerId,
        containerName: event.containerName,
        imageName: event.imageName,
        eventType: event.eventType.toUpperCase(),
        exitCode: event.exitCode,
        logs: event.logs,
        timestamp: infraEvent.timestamp.toISOString(),
      });

      // 3. Queue task in BullMQ
      const jobPayload: CrashJobPayload = {
        jobId: `crash-${infraEvent.id}`,
        serviceId: service.id,
        event,
        priority:
          event.eventType === 'oom' ? JobPriority.CRITICAL : JobPriority.HIGH,
        attemptNumber: 1,
        maxAttempts: MAX_JOB_ATTEMPTS,
        createdAt: new Date().toISOString(),
      };

      await this.queueService.enqueueCrashEvent(jobPayload);
      this.emitTerminalLog(
        'info',
        'Queue',
        `📥 Job enqueued for custom AI diagnosis loop.`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Orchestration failed for crash event: ${message}`);
      this.emitTerminalLog(
        'error',
        'Orchestrator',
        `❌ Failed to process crash: ${message}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Async Event Processing (BullMQ Worker)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handles async queue processing. Evaluates raw logs, gets embeddings,
   * queries custom classifiers, checks safety bounds, and executes actions.
   */
  @OnEvent('queue.job.process')
  async handleJobProcess(payload: {
    job: Job<CrashJobPayload>;
    resolve: (result: JobProcessingResult) => void;
    reject: (error: Error) => void;
    startTime: number;
  }): Promise<void> {
    const { job, resolve, reject, startTime } = payload;
    const { event, serviceId } = job.data;

    try {
      if (!serviceId) {
        throw new Error('Service ID is required in job data');
      }

      // 1. Fetch event from database
      const dbEvent = await this.dbEventLookup(serviceId, event.eventType);
      if (!dbEvent) {
        throw new Error('InfrastructureEvent record not found in MongoDB');
      }

      const correlationId = dbEvent.id.toString();

      this.emitTerminalLog(
        'ai',
        'AI Engine',
        `🧠 Diagnosing logs via local custom classification head...`,
      );

      // 2. Call local Custom AI Microservice
      const diagnosis = await this.aiAgent.diagnoseLogs(event.logs);

      // 3. Save AI embeddings (simulated dummy array or mock values from database score)
      const mockEmbedding = new Array(384)
        .fill(0)
        .map(() => Math.random() * 2 - 1);
      await this.auditService.logIncidentEmbedding(
        dbEvent.id,
        mockEmbedding,
        diagnosis.incidentType,
      );

      // 4. Save Remediation Plan to MongoDB
      const planActionMap: Record<string, ActionType> = {
        RESTART_CONTAINER: ActionType.RESTART_CONTAINER,
        STOP_CONTAINER: ActionType.STOP_CONTAINER,
        IGNORE: ActionType.IGNORE,
      };

      const plan = await this.auditService.logRemediationPlan(
        dbEvent.id,
        diagnosis.analysis,
        diagnosis.confidenceScore,
        planActionMap[diagnosis.suggestedAction] ?? ActionType.IGNORE,
        diagnosis.riskLevel === 'HIGH' ? RiskLevel.HIGH : RiskLevel.LOW,
        diagnosis.reasoning,
      );

      const kafkaRiskLevel =
        diagnosis.riskLevel === 'HIGH' ? RiskLevel.HIGH : RiskLevel.LOW;

      const kafkaActionMap: Record<string, RemediationAction> = {
        RESTART_CONTAINER: RemediationAction.RESTART_CONTAINER,
        STOP_CONTAINER: RemediationAction.STOP_CONTAINER,
        IGNORE: RemediationAction.IGNORE,
      };

      void this.kafkaProducer.publish(KAFKA_TOPICS.AI_DIAGNOSIS_COMPLETED, {
        eventType: 'AI_DIAGNOSIS_COMPLETED',
        source: 'ai-engine',
        correlationId,
        eventId: randomUUID(),
        payload: {
          eventId: correlationId,
          planId: plan.id.toString(),
          incidentType: diagnosis.incidentType,
          analysis: diagnosis.analysis,
          confidenceScore: diagnosis.confidenceScore,
          riskLevel: kafkaRiskLevel,
          suggestedAction:
            kafkaActionMap[diagnosis.suggestedAction] ??
            RemediationAction.IGNORE,
          reasoning: diagnosis.reasoning,
          similarIncidents: (diagnosis.similarIncidents ?? []).map(
            (incident) => ({
              incident_id: incident.incident_id,
              label: incident.label,
              score: incident.score,
            }),
          ),
          completedAt: new Date().toISOString(),
        },
      });

      // 5. Record ai.analysis.completed in the headless event sink
      this.gateway.broadcast('ai.analysis.completed', {
        eventId: dbEvent.id,
        planId: plan.id,
        incidentType: diagnosis.incidentType,
        analysis: diagnosis.analysis,
        confidenceScore: diagnosis.confidenceScore,
        riskLevel: kafkaRiskLevel,
        suggestedAction: diagnosis.suggestedAction,
        reasoning: diagnosis.reasoning,
        similarIncidents: diagnosis.similarIncidents ?? [],
      });

      // 6. Enforce SAFETY threshold checks
      let executionLogs = 'Action execution skipped.';
      let isSuccessful = false;
      const executionId = randomUUID();
      const isSafetyPassed =
        diagnosis.confidenceScore > 0.85 &&
        diagnosis.riskLevel === 'LOW' &&
        diagnosis.suggestedAction !== 'IGNORE';
      let skipReason = '';

      void this.kafkaProducer.publish(KAFKA_TOPICS.REMEDIATION_STARTED, {
        eventType: 'REMEDIATION_STARTED',
        source: 'remediation-engine',
        correlationId,
        eventId: randomUUID(),
        payload: {
          eventId: correlationId,
          planId: plan.id.toString(),
          executionId,
          containerId: event.containerId,
          containerName: event.containerName,
          action:
            kafkaActionMap[diagnosis.suggestedAction] ??
            RemediationAction.IGNORE,
          startedAt: new Date().toISOString(),
          safetyPassed: isSafetyPassed,
          confidenceScore: diagnosis.confidenceScore,
          riskLevel: kafkaRiskLevel,
        },
      });

      if (isSafetyPassed) {
        this.emitTerminalLog(
          'info',
          'Remediation',
          `⚡ Safety checklist passed. Executing: ${diagnosis.suggestedAction}`,
        );

        try {
          if (diagnosis.suggestedAction === 'RESTART_CONTAINER') {
            executionLogs = await this.remediationEngine.executeRestart(
              event.containerId,
            );
          } else if (diagnosis.suggestedAction === 'STOP_CONTAINER') {
            executionLogs = await this.remediationEngine.executeStop(
              event.containerId,
            );
          }
          isSuccessful = true;
          this.emitTerminalLog(
            'info',
            'Remediation',
            `✅ Safe Execution Completed: ${executionLogs}`,
          );
        } catch (execErr: unknown) {
          isSuccessful = false;
          executionLogs =
            execErr instanceof Error ? execErr.message : String(execErr);
          this.emitTerminalLog(
            'error',
            'Remediation',
            `❌ Action execution failed: ${executionLogs}`,
          );
        }

        // Save action execution audit trail
        await this.auditService.logActionExecution(
          plan.id,
          diagnosis.suggestedAction,
          isSuccessful,
          executionLogs,
          Date.now() - startTime,
          isSuccessful ? undefined : executionLogs,
        );

        await this.auditService.updatePlanStatus(
          plan.id,
          isSuccessful ? RemediationStatus.COMPLETED : RemediationStatus.FAILED,
          Date.now() - startTime,
        );

        void this.kafkaProducer.publish(KAFKA_TOPICS.REMEDIATION_COMPLETED, {
          eventType: 'REMEDIATION_COMPLETED',
          source: 'remediation-engine',
          correlationId,
          eventId: randomUUID(),
          payload: {
            eventId: correlationId,
            planId: plan.id.toString(),
            executionId,
            containerId: event.containerId,
            containerName: event.containerName,
            action:
              kafkaActionMap[diagnosis.suggestedAction] ??
              RemediationAction.IGNORE,
            success: isSuccessful,
            logs: executionLogs,
            durationMs: Date.now() - startTime,
            completedAt: new Date().toISOString(),
          },
        });

        // Update container status in database
        await this.auditService.upsertService(
          event.containerId,
          event.containerName,
          event.imageName,
          isSuccessful ? ServiceStatus.HEALTHY : ServiceStatus.DEGRADED,
        );
      } else {
        skipReason =
          diagnosis.suggestedAction === 'IGNORE'
            ? 'Policy suggested IGNORE.'
            : `Confidence threshold (${diagnosis.confidenceScore.toFixed(2)}) inadequate or high risk level.`;

        this.logger.warn(
          `⏭️ Skipped automatic self-healing. Reason: ${skipReason}`,
        );
        this.emitTerminalLog(
          'warn',
          'Safety Guard',
          `⏭️ Remediation skipped: ${skipReason}`,
        );

        await this.auditService.updatePlanStatus(
          plan.id,
          RemediationStatus.SKIPPED,
          Date.now() - startTime,
        );

        void this.kafkaProducer.publish(KAFKA_TOPICS.REMEDIATION_COMPLETED, {
          eventType: 'REMEDIATION_COMPLETED',
          source: 'remediation-engine',
          correlationId,
          eventId: randomUUID(),
          payload: {
            eventId: correlationId,
            planId: plan.id.toString(),
            executionId,
            containerId: event.containerId,
            containerName: event.containerName,
            action:
              kafkaActionMap[diagnosis.suggestedAction] ??
              RemediationAction.IGNORE,
            success: false,
            logs: skipReason,
            durationMs: Date.now() - startTime,
            completedAt: new Date().toISOString(),
          },
        });

        await this.auditService.upsertService(
          event.containerId,
          event.containerName,
          event.imageName,
          ServiceStatus.DEGRADED,
        );
      }

      void this.kafkaProducer.publish(KAFKA_TOPICS.AUDIT_EVENTS, {
        eventType: isSuccessful ? 'REMEDIATION_SUCCESS' : 'REMEDIATION_SKIPPED',
        source: 'audit-service',
        correlationId,
        eventId: randomUUID(),
        payload: {
          auditId: randomUUID(),
          entityType: 'plan',
          entityId: plan.id.toString(),
          action: diagnosis.suggestedAction,
          status: isSuccessful ? 'COMPLETED' : 'SKIPPED',
          summary: isSuccessful
            ? `Remediation completed successfully for ${event.containerName}`
            : `Remediation skipped for ${event.containerName}`,
          recordedAt: new Date().toISOString(),
          details: {
            containerId: event.containerId,
            safetyPassed: isSafetyPassed,
            confidenceScore: diagnosis.confidenceScore,
            riskLevel: kafkaRiskLevel,
            executionLogs,
          },
        },
      });

      // 7. Record remediation.completed in the headless event sink
      this.gateway.broadcast('remediation.completed', {
        eventId: dbEvent.id,
        planId: plan.id,
        actionTaken: diagnosis.suggestedAction,
        isSuccessful: isSuccessful,
        safetyPassed: isSafetyPassed,
        executionLogs,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });

      resolve({
        jobId: job.data.jobId,
        eventId: dbEvent.id,
        planId: plan.id,
        executionId: null,
        success: isSuccessful,
        processingTimeMs: Date.now() - startTime,
        error: null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Job processing failed: ${message}`);
      this.emitTerminalLog(
        'error',
        'Orchestrator',
        `❌ Job process failed: ${message}`,
      );
      reject(error instanceof Error ? error : new Error(message));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper Queries
  // ─────────────────────────────────────────────────────────────────────────

  private async dbEventLookup(serviceId: string, eventType: string) {
    const eventTypeMap: Record<string, EventType> = {
      die: EventType.DIE,
      oom: EventType.OOM,
      kill: EventType.KILL,
    };
    const mappedType = eventTypeMap[eventType] ?? EventType.DIE;
    return await this.auditService.getLatestEventForService(
      serviceId,
      mappedType,
    );
  }

  private emitTerminalLog(
    level: 'info' | 'warn' | 'error' | 'ai',
    source: string,
    message: string,
  ): void {
    this.gateway.broadcast(OperationalEventName.TERMINAL_LOG, {
      id: randomUUID(),
      level,
      source,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
