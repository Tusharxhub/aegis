import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { DockerService } from '../docker/docker.service.js';
import { QueueService } from '../queue/queue.service.js';
import { AiAgentService } from '../ai-agent/ai-agent.service.js';
import { AegisGateway } from '../gateway/events.gateway.js';
import type { DockerCrashEvent } from '../common/interfaces/docker-event.interface.js';
import type {
  CrashJobPayload,
  JobProcessingResult,
} from '../common/interfaces/queue-payload.interface.js';
import { JobPriority } from '../common/interfaces/queue-payload.interface.js';
import { WsEventName } from '../common/interfaces/websocket-event.interface.js';
import type { WsTerminalLog } from '../common/interfaces/websocket-event.interface.js';
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  MAX_JOB_ATTEMPTS,
} from '../common/constants/index.js';
import type { ActionType, RemediationStatus } from '@prisma/client';

/**
 * OrchestratorService — The Central Nervous System.
 *
 * Coordinates the entire crash → analyze → remediate → audit pipeline:
 *
 *   1. Docker crash event arrives via EventEmitter2.
 *   2. Upsert the Service record in Prisma.
 *   3. Create an InfrastructureEvent record.
 *   4. Enqueue the crash job to BullMQ.
 *   5. When the worker picks it up, call the AI Agent.
 *   6. If confidence > threshold, execute the remediation via Docker API.
 *   7. Save the full audit trail to Prisma.
 *   8. Broadcast every state change to the frontend via WebSocket.
 */
@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly confidenceThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dockerService: DockerService,
    private readonly queueService: QueueService,
    private readonly aiAgent: AiAgentService,
    private readonly gateway: AegisGateway,
    private readonly configService: ConfigService,
  ) {
    this.confidenceThreshold =
      parseFloat(
        this.configService.get<string>('AI_CONFIDENCE_THRESHOLD') ?? '',
      ) || DEFAULT_CONFIDENCE_THRESHOLD;
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `🧠 Orchestrator online — confidence threshold: ${this.confidenceThreshold}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handles incoming Docker crash events from the DockerService.
   * Creates DB records and enqueues the job.
   */
  @OnEvent('docker.crash')
  async handleDockerCrash(event: DockerCrashEvent): Promise<void> {
    try {
      this.emitTerminalLog('warn', 'Docker', `🚨 Container [${event.containerName}] crashed (exit: ${event.exitCode})`);

      // 1. Upsert the Service record
      const service = await this.prisma.service.upsert({
        where: { containerId: event.containerId },
        update: {
          status: 'CRASHED',
          exitCode: event.exitCode,
          lastSeenAt: new Date(),
        },
        create: {
          name: event.containerName,
          imageName: event.imageName,
          containerId: event.containerId,
          status: 'CRASHED',
          exitCode: event.exitCode,
        },
      });

      // 2. Create the InfrastructureEvent
      const infraEvent = await this.prisma.infrastructureEvent.create({
        data: {
          serviceId: service.id,
          eventType: event.eventType.toUpperCase() as 'DIE' | 'OOM' | 'KILL',
          exitCode: event.exitCode,
          rawLogs: event.logs,
          metadata: event.metadata as object,
        },
      });

      // 3. Broadcast crash to frontend
      this.gateway.broadcast(WsEventName.CONTAINER_CRASH, {
        event,
        serviceId: service.id,
        eventId: infraEvent.id,
        timestamp: new Date().toISOString(),
      });

      // 4. Enqueue for AI processing
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
      this.emitTerminalLog('info', 'Queue', `📥 Job enqueued for [${event.containerName}]`);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown orchestration error';
      this.logger.error(`Orchestration failed for crash event: ${message}`);
      this.emitTerminalLog('error', 'Orchestrator', `❌ Failed to process crash: ${message}`);
    }
  }

  /**
   * Handles queued job processing requests from the QueueService worker.
   * This is where the AI analysis and remediation execution happens.
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
      // 1. Find the infrastructure event
      const infraEvent = await this.prisma.infrastructureEvent.findFirst({
        where: {
          serviceId: serviceId ?? undefined,
          eventType: event.eventType.toUpperCase() as 'DIE' | 'OOM' | 'KILL',
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!infraEvent) {
        throw new Error('Infrastructure event not found in database');
      }

      // 2. Broadcast AI analysis start
      this.gateway.broadcast(WsEventName.AI_ANALYSIS_START, {
        eventId: infraEvent.id,
        containerName: event.containerName,
        timestamp: new Date().toISOString(),
      });
      this.emitTerminalLog('ai', 'AI Agent', `🧠 Analyzing crash for [${event.containerName}]...`);

      // 3. Call the AI Agent
      const aiResult = await this.aiAgent.analyzeCrashEvent(event);

      // 4. Stream AI output to frontend
      if (aiResult.rawOutput) {
        // Send in chunks for the live terminal effect
        const chunkSize = 50;
        for (let i = 0; i < aiResult.rawOutput.length; i += chunkSize) {
          const chunk = aiResult.rawOutput.slice(i, i + chunkSize);
          this.gateway.broadcast(WsEventName.AI_ANALYSIS_STREAM, {
            eventId: infraEvent.id,
            chunk,
            isComplete: i + chunkSize >= aiResult.rawOutput.length,
          });
          // Tiny delay for streaming effect (non-blocking)
          await new Promise((r) => setTimeout(r, 20));
        }
      }

      // 5. If AI response is invalid, skip remediation
      if (!aiResult.isValid || !aiResult.response) {
        this.emitTerminalLog('warn', 'AI Agent', `⚠️ AI response invalid — skipping remediation`);

        this.gateway.broadcast(WsEventName.AI_ANALYSIS_FAILED, {
          eventId: infraEvent.id,
          errors: aiResult.validationErrors,
          timestamp: new Date().toISOString(),
        });

        resolve({
          jobId: job.data.jobId,
          eventId: infraEvent.id,
          planId: null,
          executionId: null,
          success: false,
          processingTimeMs: Date.now() - startTime,
          error: `AI validation failed: ${aiResult.validationErrors.join(', ')}`,
        });
        return;
      }

      const { response } = aiResult;

      // 6. Save RemediationPlan to DB
      const actionTypeMap: Record<string, ActionType> = {
        restart: 'RESTART',
        scale: 'SCALE',
        rollback: 'ROLLBACK',
        alert_only: 'ALERT_ONLY',
        resource_limit_adjust: 'RESOURCE_LIMIT_ADJUST',
      };

      const plan = await this.prisma.remediationPlan.create({
        data: {
          eventId: infraEvent.id,
          aiAnalysis: response.analysis,
          confidenceScore: response.confidenceScore,
          suggestedAction: actionTypeMap[response.suggestedAction.type] ?? 'ALERT_ONLY',
          actionCommand: response.suggestedAction.command,
          actionParams: response.suggestedAction.parameters as object,
          status: 'PENDING' as RemediationStatus,
          processingTimeMs: aiResult.processingTimeMs,
        },
      });

      this.gateway.broadcast(WsEventName.AI_ANALYSIS_COMPLETE, {
        eventId: infraEvent.id,
        planId: plan.id,
        result: response,
        processingTimeMs: aiResult.processingTimeMs,
      });

      this.emitTerminalLog('ai', 'AI Agent',
        `✅ Analysis complete — confidence: ${response.confidenceScore.toFixed(2)}, action: ${response.suggestedAction.type}`
      );

      // 7. Execute remediation if confidence exceeds threshold
      let executionId: string | null = null;

      if (
        response.confidenceScore >= this.confidenceThreshold &&
        response.suggestedAction.type !== 'alert_only'
      ) {
        executionId = await this.executeRemediation(
          plan.id,
          event,
          response.suggestedAction.type,
          infraEvent.id,
        );
      } else {
        const reason =
          response.confidenceScore < this.confidenceThreshold
            ? `Confidence ${response.confidenceScore.toFixed(2)} below threshold ${this.confidenceThreshold}`
            : 'Action type is alert_only';

        await this.prisma.remediationPlan.update({
          where: { id: plan.id },
          data: { status: 'SKIPPED' as RemediationStatus },
        });

        this.emitTerminalLog('info', 'Executor', `⏭️ Skipped auto-remediation: ${reason}`);
      }

      resolve({
        jobId: job.data.jobId,
        eventId: infraEvent.id,
        planId: plan.id,
        executionId,
        success: true,
        processingTimeMs: Date.now() - startTime,
        error: null,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown processing error';
      this.logger.error(`Job processing failed: ${message}`);
      this.emitTerminalLog('error', 'Orchestrator', `❌ Job failed: ${message}`);
      reject(error instanceof Error ? error : new Error(message));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Remediation Executor
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute the AI-suggested remediation action via the Docker API.
   * Currently supports: restart, alert_only. Other actions log and skip.
   */
  private async executeRemediation(
    planId: string,
    event: DockerCrashEvent,
    actionType: string,
    eventId: string,
  ): Promise<string> {
    const executionId = randomUUID();
    const startTime = Date.now();

    this.gateway.broadcast(WsEventName.REMEDIATION_EXECUTING, {
      eventId,
      planId,
      executionId,
      action: actionType,
      timestamp: new Date().toISOString(),
    });

    this.emitTerminalLog('info', 'Executor', `⚡ Executing remediation: ${actionType} on [${event.containerName}]`);

    try {
      let executionLogs = '';

      switch (actionType) {
        case 'restart': {
          await this.dockerService.restartContainer(event.containerId);
          executionLogs = `Container ${event.containerName} restarted successfully.`;

          // Update service status
          await this.prisma.service.update({
            where: { containerId: event.containerId },
            data: {
              status: 'RESTARTING',
              restartCount: { increment: 1 },
            },
          });
          break;
        }

        case 'scale':
        case 'rollback':
        case 'resource_limit_adjust': {
          // These actions require external orchestration (K8s, Swarm, etc.)
          // For now, log the intent and mark as requiring manual intervention.
          executionLogs = `Action "${actionType}" logged for manual execution. Aegis does not have ${actionType} authority in standalone Docker mode.`;
          this.emitTerminalLog('warn', 'Executor', `⚠️ ${actionType} requires manual intervention`);
          break;
        }

        default: {
          executionLogs = `Unknown action type: ${actionType}`;
          break;
        }
      }

      const durationMs = Date.now() - startTime;

      // Save execution record
      const execution = await this.prisma.actionExecution.create({
        data: {
          id: executionId,
          planId,
          actionTaken: actionType,
          isSuccessful: true,
          executionLogs,
          durationMs,
        },
      });

      // Update plan status
      await this.prisma.remediationPlan.update({
        where: { id: planId },
        data: { status: 'COMPLETED' as RemediationStatus },
      });

      this.gateway.broadcast(WsEventName.REMEDIATION_COMPLETE, {
        eventId,
        planId,
        executionId: execution.id,
        action: actionType,
        success: true,
        logs: executionLogs,
        timestamp: new Date().toISOString(),
      });

      this.emitTerminalLog('info', 'Executor', `✅ Remediation complete (${durationMs}ms)`);

      return execution.id;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown execution error';
      const durationMs = Date.now() - startTime;

      await this.prisma.actionExecution.create({
        data: {
          id: executionId,
          planId,
          actionTaken: actionType,
          isSuccessful: false,
          executionLogs: `Execution failed: ${message}`,
          errorMessage: message,
          durationMs,
        },
      });

      await this.prisma.remediationPlan.update({
        where: { id: planId },
        data: { status: 'FAILED' as RemediationStatus },
      });

      this.gateway.broadcast(WsEventName.REMEDIATION_FAILED, {
        eventId,
        planId,
        executionId,
        action: actionType,
        success: false,
        logs: `Execution failed: ${message}`,
        timestamp: new Date().toISOString(),
      });

      this.emitTerminalLog('error', 'Executor', `❌ Remediation failed: ${message}`);

      return executionId;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Terminal Log Helper
  // ─────────────────────────────────────────────────────────────────────────

  private emitTerminalLog(
    level: WsTerminalLog['level'],
    source: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    const logEntry: WsTerminalLog = {
      id: randomUUID(),
      level,
      source,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    };

    this.gateway.broadcast(WsEventName.TERMINAL_LOG, logEntry);
  }
}
