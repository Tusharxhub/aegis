import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, Partitioners, type Producer } from 'kafkajs';
import { randomUUID } from 'crypto';
import { KAFKA_SERVICE_NAME, type KafkaTopic } from './kafka.constants.js';
import { KafkaConfigService } from './kafka.config.js';
import { KafkaHealthService } from './kafka.health.js';
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
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Kafka producer initialization failed: ${message}`);
      this.health.setError(message);
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
    return new Kafka({
      clientId: this.getClientId(),
      brokers: this.getBrokers(),
      ssl: this.kafkaConfig.isSslEnabled(),
      retry: {
        initialRetryTime: 300,
        retries: this.kafkaConfig.getProducerRetryLimit(),
      },
    });
  }

  async connect(): Promise<void> {
    if (this.ready && this.producer) {
      return;
    }

    this.kafka ??= this.buildKafka();
    this.producer ??= this.kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
      idempotent: true,
      allowAutoTopicCreation: true,
      retry: {
        retries: this.kafkaConfig.getProducerRetryLimit(),
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
        retries: this.kafkaConfig.getProducerRetryLimit(),
        delayMs: 250,
      },
    );

    await this.health.captureClusterMetadata(this.kafka);
    this.ready = true;
    this.health.markProducerConnected();
    this.logger.log('[KAFKA] Kafka producer connected');
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
    const envelope: KafkaEventEnvelope<Record<string, unknown>> = {
      eventId: context.eventId ?? randomUUID(),
      eventType: context.eventType,
      source: context.source,
      timestamp: context.timestamp ?? new Date().toISOString(),
      correlationId: context.correlationId ?? randomUUID(),
      serviceName: context.serviceName ?? KAFKA_SERVICE_NAME,
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
            value: JSON.stringify(envelope),
            timestamp: envelope.timestamp,
            headers: {
              'event-id': envelope.eventId,
              'event-type': envelope.eventType,
              source: envelope.source,
              'service-name': envelope.serviceName,
              'correlation-id': envelope.correlationId,
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
