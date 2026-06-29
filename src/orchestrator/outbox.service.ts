import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service.js';
import { KafkaProducerService } from '../kafka/kafka.producer.js';
import { randomUUID } from 'crypto';
import type { KafkaTopic } from '../kafka/kafka.constants.js';
import type {
  KafkaPublishContext,
  KafkaPayloadForTopic,
} from '../kafka/kafka.types.js';

/** Maximum number of retry attempts before marking an event as FAILED. */
const MAX_ATTEMPTS = 10;

/** Retry worker interval in milliseconds. */
const RETRY_INTERVAL_MS = 10_000;

/** Maximum number of events to process in a single retry batch. */
const BATCH_SIZE = 20;

/** Base delay for exponential backoff in milliseconds. */
const BASE_BACKOFF_MS = 1_000;

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(
    private readonly mongoService: MongoService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  onModuleInit(): void {
    this.startRetryWorker();
    this.logger.log('Outbox retry worker started.');
  }

  onModuleDestroy(): void {
    this.stopRetryWorker();
    this.logger.log('Outbox retry worker stopped.');
  }

  /**
   * Store an event in the outbox collection, then attempt to publish it to Kafka.
   * If Kafka publish fails, the event remains PENDING for the retry worker to pick up.
   */
  async storeAndPublish<TTopic extends KafkaTopic>(
    topic: TTopic,
    context: KafkaPublishContext<Record<string, unknown>> & {
      readonly payload: KafkaPayloadForTopic<TTopic>;
    },
  ): Promise<{ eventId: string; published: boolean }> {
    const eventId = context.eventId ?? randomUUID();

    // Step 1: Persist event in MongoDB outbox (always succeeds or throws)
    const outboxPayload: Record<string, unknown> = {
      eventType: context.eventType,
      source: context.source,
      correlationId: context.correlationId,
      timestamp: context.timestamp ?? new Date().toISOString(),
      payload: context.payload,
    };

    await this.mongoService.OutboxModel.create({
      eventId,
      topic,
      key: context.correlationId ?? null,
      payload: outboxPayload,
      headers: {
        eventType: context.eventType,
        source: context.source,
        ...(context.correlationId
          ? { correlationId: context.correlationId }
          : {}),
      },
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
    });

    // Step 2: Attempt immediate Kafka publish
    let published = false;
    try {
      published = await this.kafkaProducer.publish(topic, {
        ...context,
        eventId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[Outbox] Immediate Kafka publish failed for eventId=${eventId}: ${message}`,
      );
    }

    if (published) {
      // Mark as PUBLISHED
      await this.mongoService.OutboxModel.updateOne(
        { eventId },
        {
          $set: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
          },
        },
      );
    } else {
      // Leave as PENDING, update attempt metadata for retry
      await this.mongoService.OutboxModel.updateOne(
        { eventId },
        {
          $set: {
            lastError: 'Immediate publish failed — queued for retry',
            nextAttemptAt: new Date(Date.now() + BASE_BACKOFF_MS),
          },
          $inc: { attempts: 1 },
        },
      );
    }

    return { eventId, published };
  }

  /**
   * Process a batch of pending outbox events that are ready for retry.
   */
  private async processRetryBatch(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const now = new Date();
      let processed = 0;

      while (processed < BATCH_SIZE) {
        // Atomically claim a pending event ready for retry
        const event = await this.mongoService.OutboxModel.findOneAndUpdate(
          {
            status: 'PENDING',
            nextAttemptAt: { $lte: now },
          },
          {
            $set: { nextAttemptAt: new Date(Date.now() + 60_000) }, // Temporarily push forward to prevent re-claim
            $inc: { attempts: 1 },
          },
          { returnDocument: 'after', sort: { nextAttemptAt: 1 } },
        );

        if (!event) {
          break; // No more events to process
        }

        processed++;
        const attempts: number = event.attempts;

        // Check if max attempts exceeded
        if (attempts > MAX_ATTEMPTS) {
          await this.mongoService.OutboxModel.updateOne(
            { _id: event._id },
            {
              $set: {
                status: 'FAILED',
                lastError: `Exceeded max attempts (${MAX_ATTEMPTS})`,
              },
            },
          );
          this.logger.error(
            `[Outbox] Event ${event.eventId as string} marked FAILED after ${MAX_ATTEMPTS} attempts.`,
          );
          continue;
        }

        // Attempt to publish
        let published = false;
        try {
          const payload = event.payload as Record<string, unknown>;
          published = await this.kafkaProducer.publish(
            event.topic as KafkaTopic,
            {
              eventId: event.eventId as string,
              eventType: payload.eventType as string,
              source: payload.source as
                | 'watchman'
                | 'incident-service'
                | 'ai-engine'
                | 'remediation-engine'
                | 'audit-service',
              correlationId: payload.correlationId as string | undefined,
              timestamp: payload.timestamp as string | undefined,
              payload: payload.payload,
            } as any, // Outbox stores serialized payloads — strict generic types are not recoverable at retry boundary
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[Outbox] Retry publish failed for eventId=${event.eventId as string} (attempt ${attempts}): ${message}`,
          );
        }

        if (published) {
          await this.mongoService.OutboxModel.updateOne(
            { _id: event._id },
            {
              $set: {
                status: 'PUBLISHED',
                publishedAt: new Date(),
                lastError: null,
              },
            },
          );
          this.logger.log(
            `[Outbox] Event ${event.eventId as string} published on retry (attempt ${attempts}).`,
          );
        } else {
          // Calculate exponential backoff: base * 2^(attempts-1)
          const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempts - 1);
          const nextAttempt = new Date(Date.now() + backoffMs);

          await this.mongoService.OutboxModel.updateOne(
            { _id: event._id },
            {
              $set: {
                nextAttemptAt: nextAttempt,
                lastError: `Retry attempt ${attempts} failed`,
              },
            },
          );
        }
      }

      if (processed > 0) {
        this.logger.log(
          `[Outbox] Retry batch processed ${processed} event(s).`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Outbox] Retry worker error: ${message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private startRetryWorker(): void {
    this.retryTimer = setInterval(() => {
      void this.processRetryBatch();
    }, RETRY_INTERVAL_MS);
  }

  private stopRetryWorker(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
