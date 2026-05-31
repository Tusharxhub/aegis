import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import {
  Kafka,
  logLevel,
  type Consumer,
  type EachMessagePayload,
} from 'kafkajs';
import { AegisGateway } from '../gateway/events.gateway.js';
import {
  KAFKA_CONSUMER_SUBSCRIPTIONS,
  type KafkaConsumerGroupId,
  type KafkaTopic,
} from './kafka.constants.js';
import { KafkaConfigService } from './kafka.config.js';
import { KafkaHealthService } from './kafka.health.js';
import {
  isKafkaEventEnvelope,
  isTopicPayload,
  type KafkaEventEnvelope,
} from './kafka.types.js';

type KafkaDashboardEvent = {
  readonly topic: KafkaTopic;
  readonly envelope: KafkaEventEnvelope;
  readonly receivedAt: string;
  readonly payloadSummary: string;
};

@Injectable()
export class KafkaConsumerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(KafkaConsumerService.name);
  private kafka: Kafka | null = null;
  private consumers = new Map<KafkaConsumerGroupId, Consumer>();
  private started = false;

  constructor(
    private readonly kafkaConfig: KafkaConfigService,
    private readonly gateway: AegisGateway,
    private readonly health: KafkaHealthService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.start();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Kafka consumer initialization failed: ${message}`);
      this.health.setError(message);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
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
      logLevel: logLevel.ERROR,
      retry: {
        retries: this.kafkaConfig.getConsumerRetryLimit(),
      },
    });
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.kafka ??= this.buildKafka();
    this.health.setBroker(this.getBrokers());
    this.health.setStartupDiagnostics(this.kafkaConfig.getDiagnostics());

    this.logger.log(
      `[KAFKA] Connecting to broker: ${this.getBrokers().join(', ')}`,
    );

    const consumerEntries: Array<
      [KafkaConsumerGroupId, readonly KafkaTopic[]]
    > = Object.entries(KAFKA_CONSUMER_SUBSCRIPTIONS) as Array<
      [KafkaConsumerGroupId, readonly KafkaTopic[]]
    >;

    const consumerStarts = consumerEntries.map(async ([groupId, topics]) => {
      const consumer = this.kafka!.consumer({ groupId });
      this.consumers.set(groupId, consumer);

      try {
        await this.health.withRetry(
          `Kafka consumer connection for ${groupId}`,
          async () => {
            await consumer.connect();
            return undefined;
          },
          {
            retries: this.kafkaConfig.getConsumerRetryLimit(),
            delayMs: 250,
          },
        );

        for (const topic of topics) {
          await this.health.withRetry(
            `Kafka consumer subscription for ${groupId} -> ${topic}`,
            async () => {
              await consumer.subscribe({ topic, fromBeginning: false });
              return undefined;
            },
            {
              retries: 3,
              delayMs: 150,
            },
          );
        }

        this.health.markConsumerState(groupId, true, topics);

        void consumer
          .run({
            autoCommit: true,
            eachMessage: (message: EachMessagePayload): Promise<void> =>
              Promise.resolve(this.handleMessage(groupId, message)),
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Kafka consumer group ${groupId} runtime failure: ${message}`,
            );
            this.health.markConsumerState(groupId, false, topics);
            this.health.setError(message);
          });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Kafka consumer group ${groupId} failed to start: ${message}`,
        );
        this.health.markConsumerState(groupId, false, topics);
        this.health.setError(message);
      }
    });

    await Promise.all(consumerStarts);

    this.started = true;
    this.logger.log('[KAFKA] Kafka consumers connected');
    this.logger.log('[KAFKA] Subscribed topics initialized');
  }

  async stop(): Promise<void> {
    const disconnectJobs = Array.from(this.consumers.entries()).map(
      async ([groupId, consumer]) => {
        try {
          await consumer.disconnect();
          this.health.markConsumerState(
            groupId,
            false,
            KAFKA_CONSUMER_SUBSCRIPTIONS[groupId],
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Kafka consumer group ${groupId} disconnect warning: ${message}`,
          );
        }
      },
    );

    await Promise.allSettled(disconnectJobs);

    if (disconnectJobs.length > 0) {
      this.logger.log('[KAFKA] Kafka consumers stopped gracefully');
    }

    this.consumers.clear();
    this.started = false;
  }

  private handleMessage(
    groupId: KafkaConsumerGroupId,
    message: EachMessagePayload,
  ): void {
    const raw = message.message.value?.toString('utf8');
    if (!raw) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error: unknown) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Malformed Kafka event on ${message.topic} (${groupId}): ${messageText}`,
      );
      return;
    }

    if (!isKafkaEventEnvelope(parsed)) {
      this.logger.warn(
        `Rejected Kafka event without valid envelope on topic ${message.topic} (group ${groupId}).`,
      );
      return;
    }

    if (!isTopicPayload(message.topic as KafkaTopic, parsed.payload)) {
      this.logger.warn(
        `Rejected Kafka event with invalid payload structure on topic ${message.topic} (group ${groupId}).`,
      );
      return;
    }

    this.health.markConsumed(parsed.timestamp);

    const streamEvent: KafkaDashboardEvent = {
      topic: message.topic as KafkaTopic,
      envelope: parsed,
      receivedAt: new Date().toISOString(),
      payloadSummary: this.summarizePayload(parsed.payload),
    };

    void streamEvent;

    this.logger.debug(
      `[${groupId}] ${message.topic} :: ${parsed.eventType} :: ${parsed.correlationId}`,
    );
  }

  private summarizePayload(payload: Record<string, unknown>): string {
    const keys = Object.keys(payload).slice(0, 4);
    if (keys.length === 0) {
      return '{}';
    }

    const summary: Record<string, unknown> = {};
    for (const key of keys) {
      summary[key] = payload[key];
    }

    return JSON.stringify(summary);
  }
}
