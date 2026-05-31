import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  CrashJobPayload,
  JobProcessingResult,
  QueueHealthMetrics,
} from '../common/interfaces/queue-payload.interface.js';
import {
  REMEDIATION_QUEUE,
  MAX_JOB_ATTEMPTS,
} from '../common/constants/index.js';

/**
 * QueueService — The Broker.
 *
 * Manages BullMQ producer and worker backed by Upstash (serverless Redis).
 * - Producer: Enqueues crash events off the main thread.
 * - Worker: Processes jobs and emits internal events for the Orchestrator.
 * - QueueEvents: Monitors job lifecycle for operational telemetry.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queue!: Queue<CrashJobPayload, JobProcessingResult>;
  private worker!: Worker<CrashJobPayload, JobProcessingResult>;
  private queueEvents!: QueueEvents;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit(): void {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.error(
        '❌ REDIS_URL is not configured. Queue will not start.',
      );
      return;
    }

    const connection = this.parseRedisUrl(redisUrl);

    // ── Producer ──────────────────────────────────────────────────────────
    this.queue = new Queue<CrashJobPayload, JobProcessingResult>(
      REMEDIATION_QUEUE,
      {
        connection,
        defaultJobOptions: {
          attempts: MAX_JOB_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 200 },
        },
      },
    );

    // ── Worker ────────────────────────────────────────────────────────────
    this.worker = new Worker<CrashJobPayload, JobProcessingResult>(
      REMEDIATION_QUEUE,
      async (job: Job<CrashJobPayload>) => {
        return this.processJob(job);
      },
      {
        connection,
        concurrency: 3,
        limiter: {
          max: 10,
          duration: 60_000,
        },
      },
    );

    this.worker.on('completed', (job: Job<CrashJobPayload>) => {
      this.logger.log(
        `✅ Job ${job.id} completed for container [${job.data.event.containerName}]`,
      );
    });

    this.worker.on(
      'failed',
      (job: Job<CrashJobPayload> | undefined, err: Error) => {
        this.logger.error(
          `❌ Job ${job?.id ?? 'unknown'} failed: ${err.message}`,
        );
      },
    );

    // ── Queue Events ──────────────────────────────────────────────────────
    this.queueEvents = new QueueEvents(REMEDIATION_QUEUE, { connection });

    this.logger.log('🚀 BullMQ queue initialized (Upstash Redis).');
  }

  async onModuleDestroy(): Promise<void> {
    const teardownSteps: Promise<unknown>[] = [];

    if (this.worker) {
      this.logger.log('[BULLMQ] Disconnecting worker...');
      teardownSteps.push(this.worker.close());
    }

    if (this.queueEvents) {
      this.logger.log('[BULLMQ] Disconnecting queue events...');
      teardownSteps.push(this.queueEvents.close());
    }

    if (this.queue) {
      this.logger.log('[BULLMQ] Disconnecting queue...');
      teardownSteps.push(this.queue.close());
    }

    await Promise.allSettled(teardownSteps);
    this.logger.log('[BULLMQ] BullMQ shutdown complete.');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Producer API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Enqueue a crash event for AI analysis and remediation.
   */
  async enqueueCrashEvent(payload: CrashJobPayload): Promise<string> {
    const job = await this.queue.add(
      `crash:${payload.event.containerName}`,
      payload,
      {
        priority: payload.priority,
        jobId: payload.jobId,
      },
    );

    this.logger.log(
      `📥 Enqueued job ${job.id} for [${payload.event.containerName}] (priority: ${payload.priority})`,
    );

    return job.id ?? payload.jobId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Worker Processing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Job processor — emits an event for the Orchestrator to handle the
   * actual AI analysis and remediation logic. This keeps queue concerns
   * separated from business logic.
   */
  private async processJob(
    job: Job<CrashJobPayload>,
  ): Promise<JobProcessingResult> {
    const startTime = Date.now();

    this.logger.log(
      `⚙️  Processing job ${job.id} — container: [${job.data.event.containerName}]`,
    );

    return new Promise<JobProcessingResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Job ${job.id} timed out after 120s`));
      }, 120_000);

      // Emit to the orchestrator and wait for the result
      this.eventEmitter.emit('queue.job.process', {
        job,
        resolve: (result: JobProcessingResult) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
        startTime,
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get current queue health metrics for the dashboard.
   */
  async getQueueMetrics(): Promise<QueueHealthMetrics> {
    if (!this.queue) {
      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0,
      };
    }

    const [waiting, active, completed, failed, delayed, paused] =
      await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
        this.queue.isPaused().then((p) => (p ? 1 : 0)),
      ]);

    return { waiting, active, completed, failed, delayed, paused };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Parse a Redis URL into BullMQ connection options.
   * Supports both redis:// and rediss:// (TLS for Upstash).
   */
  private parseRedisUrl(url: string): {
    host: string;
    port: number;
    password?: string;
    tls?: Record<string, unknown>;
    maxRetriesPerRequest: null;
  } {
    const parsed = new URL(url);
    const useTls = parsed.protocol === 'rediss:';

    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || (useTls ? '6380' : '6379'), 10),
      password: parsed.password || undefined,
      ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
      maxRetriesPerRequest: null,
    };
  }
}
