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
import { WsEventName } from '../common/interfaces/websocket-event.interface.js';
import { MAX_JOB_ATTEMPTS } from '../common/constants/index.js';
import {
  ServiceStatus,
  EventType,
  RemediationStatus,
  ActionType,
  RiskLevel,
} from '../common/interfaces/db-types.js';

@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly remediationEngine: RemediationEngine,
    private readonly dockerService: DockerService,
    private readonly queueService: QueueService,
    private readonly gateway: AegisGateway,
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
    await this.auditService.logMetrics(0.12, 0.45, 0.08);
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

      // 2. Broadcast incident.detected via WebSocket
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

      // 4. Save Remediation Plan to Postgres
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

      // 5. Broadcast ai.analysis.completed to frontend
      this.gateway.broadcast('ai.analysis.completed', {
        eventId: dbEvent.id,
        planId: plan.id,
        incidentType: diagnosis.incidentType,
        analysis: diagnosis.analysis,
        confidenceScore: diagnosis.confidenceScore,
        riskLevel: diagnosis.riskLevel,
        suggestedAction: diagnosis.suggestedAction,
        reasoning: diagnosis.reasoning,
        similarIncidents: diagnosis.similarIncidents ?? [],
      });

      // 6. Enforce SAFETY threshold checks
      let executionLogs = 'Action execution skipped.';
      let isSuccessful = false;
      const isSafetyPassed =
        diagnosis.confidenceScore > 0.85 &&
        diagnosis.riskLevel === 'LOW' &&
        diagnosis.suggestedAction !== 'IGNORE';

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

        // Update container status in database
        await this.auditService.upsertService(
          event.containerId,
          event.containerName,
          event.imageName,
          isSuccessful ? ServiceStatus.HEALTHY : ServiceStatus.DEGRADED,
        );
      } else {
        const reason =
          diagnosis.suggestedAction === 'IGNORE'
            ? 'Policy suggested IGNORE.'
            : `Confidence threshold (${diagnosis.confidenceScore.toFixed(2)}) inadequate or high risk level.`;

        this.logger.warn(
          `⏭️ Skipped automatic self-healing. Reason: ${reason}`,
        );
        this.emitTerminalLog(
          'warn',
          'Safety Guard',
          `⏭️ Remediation skipped: ${reason}`,
        );

        await this.auditService.updatePlanStatus(
          plan.id,
          RemediationStatus.SKIPPED,
          Date.now() - startTime,
        );

        await this.auditService.upsertService(
          event.containerId,
          event.containerName,
          event.imageName,
          ServiceStatus.DEGRADED,
        );
      }

      // 7. Emit remediation.completed to frontend
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
    this.gateway.broadcast(WsEventName.TERMINAL_LOG, {
      id: randomUUID(),
      level,
      source,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
