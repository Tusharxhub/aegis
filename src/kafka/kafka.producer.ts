import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, Partitioners, type Producer } from 'kafkajs';
import { randomUUID } from 'crypto';
import { type KafkaTopic } from './kafka.constants.js';
import { KafkaConfigService } from './kafka.config.js';
import { KafkaHealthService } from './kafka.health.js';
import { serializeAegisEvent } from './kafka.types.js';
import type {
  KafkaEventEnvelope,
  KafkaPayloadForTopic,
  KafkaPublishContext,
} from './kafka.types.js';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private kafka: Kafka | null = null;
  private producer: Producer | null = null;
  private ready = false;

  constructor(
    private readonly kafkaConfig: KafkaConfigService,
    private readonly health: KafkaHealthService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect().catch((error: unknown) => {
      this.logger.warn(
        `[KAFKA] Broker unavailable. Start infrastructure using: npm run infra:up`,
      );
      this.logger.warn(`[KAFKA] Producer offline`);
      this.health.setError(
        'Kafka is unreachable. Start infrastructure with npm run infra:up.',
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  private getBrokers(): string[] {
    return this.kafkaConfig.getBrokers();
  }

  private getClientId(): string {
    return this.kafkaConfig.getClientId();
  }

  private buildKafka(): Kafka {
    process.env.KAFKAJS_NO_PARTITIONER_WARNING = '1';

    return new Kafka({
      clientId: this.getClientId(),
      brokers: this.getBrokers(),
      ssl: this.kafkaConfig.isSslEnabled(),
      retry: {
        initialRetryTime: this.kafkaConfig.getInitialRetryTimeMs(),
        retries: this.kafkaConfig.getConnectionRetryLimit(),
      },
    });
  }

  async connect(): Promise<void> {
    if (this.ready && this.producer) {
      return;
    }

    this.kafka ??= this.buildKafka();
    this.producer ??= this.kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1,
      createPartitioner: Partitioners.LegacyPartitioner,
      retry: {
        retries: Number.MAX_SAFE_INTEGER,
      },
    });

    this.health.setBroker(this.getBrokers());
    this.health.setStartupDiagnostics(this.kafkaConfig.getDiagnostics());

    this.logger.log(
      `[KAFKA] Connecting to broker: ${this.getBrokers().join(', ')}`,
    );

    await this.health.withRetry(
      'Kafka producer connection',
      async () => {
        await this.producer!.connect();
        return undefined;
      },
      {
        retries: this.kafkaConfig.getConnectionRetryLimit(),
        delayMs: 250,
      },
    );

    await this.health.captureClusterMetadata(this.kafka);
    this.ready = true;
    this.health.markProducerConnected();
    this.logger.log('[KAFKA] Kafka producer connected');
    this.logger.log('[KAFKA] Retry policies active');
    this.logger.log('[KAFKA] Idempotent producer enabled');
  }

  async disconnect(): Promise<void> {
    if (!this.producer || !this.ready) {
      return;
    }

    try {
      await this.producer.disconnect();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Kafka producer disconnect warning: ${message}`);
    } finally {
      this.ready = false;
      this.health.markProducerDisconnected();
    }
  }

  async publish<TTopic extends KafkaTopic>(
    topic: TTopic,
    context: KafkaPublishContext<Record<string, unknown>> & {
      readonly payload: KafkaPayloadForTopic<TTopic>;
    },
  ): Promise<boolean> {
    const messageTimestamp = Date.now().toString();
    const envelope: KafkaEventEnvelope<Record<string, unknown>> = {
      eventId: context.eventId ?? randomUUID(),
      eventType: context.eventType,
      source: context.source,
      timestamp: context.timestamp ?? new Date().toISOString(),
      correlationId: context.correlationId ?? randomUUID(),
      payload: context.payload,
    };

    try {
      if (!this.ready) {
        await this.connect();
      }

      if (!this.producer) {
        throw new Error('Kafka producer is not initialized');
      }

      await this.producer.send({
        topic,
        messages: [
          {
            key: envelope.correlationId,
            value: serializeAegisEvent(envelope),
            timestamp: messageTimestamp,
            headers: {
              eventType: String(envelope.eventType),
              source: String(envelope.source),
              correlationId: String(envelope.correlationId),
              timestamp: messageTimestamp,
            },
          },
        ],
      });

      this.health.markPublished(envelope.timestamp);
      this.health.setError(null);
      this.logger.debug(
        `[KAFKA] Publish succeeded :: topic=${topic} eventType=${envelope.eventType}`,
      );
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.health.setError(message);
      this.logger.error(`Kafka publish failed for topic ${topic}: ${message}`);
      return false;
    }
  }

  getHealthSnapshot() {
    return this.health.getSnapshot();
  }
}
