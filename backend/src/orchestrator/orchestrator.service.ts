import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import type { Job } from 'bullmq';
import { MongoService } from '../mongo/mongo.service.js';
import { DockerService } from '../docker/docker.service.js';
import { QueueService } from '../queue/queue.service.js';
import { AegisGateway } from '../gateway/events.gateway.js';
import { RlCoordinatorService } from './rl-coordinator.service.js';
import type { DockerCrashEvent } from '../common/interfaces/docker-event.interface.js';
import type {
  CrashJobPayload,
  JobProcessingResult,
} from '../common/interfaces/queue-payload.interface.js';
import { JobPriority } from '../common/interfaces/queue-payload.interface.js';
import { WsEventName } from '../common/interfaces/websocket-event.interface.js';
import {
  MAX_JOB_ATTEMPTS,
} from '../common/constants/index.js';

@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly mongoService: MongoService,
    private readonly dockerService: DockerService,
    private readonly queueService: QueueService,
    private readonly gateway: AegisGateway,
    private readonly configService: ConfigService,
    private readonly rlCoordinator: RlCoordinatorService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('🧠 Core Orchestrator online — MongoDB/RL pipeline configured.');
  }

  /**
   * Daily 3:00 AM Cron Job to train the local RL brain on episodes collected in Mongo.
   */
  @Cron('0 0 3 * * *')
  async handleDailyTraining(): Promise<void> {
    this.logger.log('📅 Scheduled daily RL brain training task triggered at 3:00 AM.');
    try {
      const result = await this.rlCoordinator.triggerManualTraining();
      this.logger.log(`📅 Scheduled daily training completed: ${JSON.stringify(result)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`❌ Scheduled daily training failed: ${msg}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handles incoming Docker crash events from the DockerService.
   * Creates Mongo records and enqueues the job.
   */
  @OnEvent('docker.crash')
  async handleDockerCrash(event: DockerCrashEvent): Promise<void> {
    try {
      this.emitTerminalLog('warn', 'Docker', `🚨 Container [${event.containerName}] crashed (exit: ${event.exitCode})`);

      // 1. Upsert the Service record in MongoDB
      const service = await this.mongoService.ServiceModel.findOneAndUpdate(
        { containerId: event.containerId },
        {
          name: event.containerName,
          imageName: event.imageName,
          containerId: event.containerId,
          status: 'CRASHED',
          exitCode: event.exitCode,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
        { upsert: true, new: true },
      );

      // 2. Create the InfrastructureEvent in MongoDB
      const eventId = randomUUID();
      const infraEvent = await this.mongoService.EventModel.create({
        _id: eventId,
        serviceId: service._id.toString(),
        eventType: event.eventType.toUpperCase(),
        exitCode: event.exitCode,
        rawLogs: event.logs,
        metadata: event.metadata,
        timestamp: new Date(),
      });

      // 3. Broadcast crash to frontend
      this.gateway.broadcast(WsEventName.CONTAINER_CRASH, {
        event,
        serviceId: service._id.toString(),
        eventId: infraEvent._id.toString(),
        timestamp: new Date().toISOString(),
      });

      // 4. Enqueue for RL action prediction processing
      const jobPayload: CrashJobPayload = {
        jobId: `crash-${infraEvent._id}`,
        serviceId: service._id.toString(),
        event,
        priority:
          event.eventType === 'oom' ? JobPriority.CRITICAL : JobPriority.HIGH,
        attemptNumber: 1,
        maxAttempts: MAX_JOB_ATTEMPTS,
        createdAt: new Date().toISOString(),
      };

      await this.queueService.enqueueCrashEvent(jobPayload);
      this.emitTerminalLog('info', 'Queue', `📥 Job enqueued for container [${event.containerName}]`);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown orchestration error';
      this.logger.error(`Orchestration failed for crash event: ${message}`);
      this.emitTerminalLog('error', 'Orchestrator', `❌ Failed to process crash: ${message}`);
    }
  }

  /**
   * Handles queued job processing requests from the QueueService worker.
   * This is where RL embedding retrieval, inference, and execution are triggered.
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
      // 1. Retrieve the latest infrastructure event from MongoDB
      const infraEvent = await this.mongoService.EventModel.findOne({
        serviceId,
        eventType: event.eventType.toUpperCase(),
      }).sort({ timestamp: -1 });

      if (!infraEvent) {
        throw new Error('Infrastructure event not found in MongoDB');
      }

      // 2. Delegate the prediction & execution steps to RlCoordinatorService
      await this.rlCoordinator.processCrashLoop(
        event,
        serviceId,
        infraEvent._id.toString(),
      );

      // Resolve the BullMQ job immediately so the queue flow remains responsive
      resolve({
        jobId: job.data.jobId,
        eventId: infraEvent._id.toString(),
        planId: null,
        executionId: null,
        success: true,
        processingTimeMs: Date.now() - startTime,
        error: null,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown processing error';
      this.logger.error(`Job processing failed: ${message}`);
      this.emitTerminalLog('error', 'Orchestrator', `❌ Job processing failed: ${message}`);
      reject(error instanceof Error ? error : new Error(message));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Terminal Log Helper
  // ─────────────────────────────────────────────────────────────────────────

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
