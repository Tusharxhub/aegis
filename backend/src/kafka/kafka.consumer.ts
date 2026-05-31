import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Kafka,
  logLevel,
  type Consumer,
  type EachMessagePayload,
} from 'kafkajs';
import { AegisGateway } from '../gateway/events.gateway.js';
import { OperationalEventName } from '../common/interfaces/operational-event.interface.js';
import {
  KAFKA_CONSUMER_GROUPS,
  KAFKA_CONSUMER_SUBSCRIPTIONS,
  type KafkaConsumerGroupId,
  type KafkaTopic,
} from './kafka.constants.js';
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
    private readonly configService: ConfigService,
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
    const configured =
      this.configService.get<string>('KAFKA_BROKER') ?? 'aegis-kafka:9092';

    return configured
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
  }

  private getClientId(): string {
    return (
      this.configService.get<string>('KAFKA_CLIENT_ID') ?? 'aegis-orchestrator'
    );
  }

  private buildKafka(): Kafka {
    return new Kafka({
      clientId: this.getClientId(),
      brokers: this.getBrokers(),
      ssl: false,
      logLevel: logLevel.ERROR,
      retry: {
        retries: 8,
      },
    });
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.kafka ??= this.buildKafka();
    this.health.setBroker(this.getBrokers());

    const consumerEntries: Array<
      [KafkaConsumerGroupId, readonly KafkaTopic[]]
    > = Object.entries(KAFKA_CONSUMER_SUBSCRIPTIONS) as Array<
      [KafkaConsumerGroupId, readonly KafkaTopic[]]
    >;

    const consumerStarts = consumerEntries.map(async ([groupId, topics]) => {
      const consumer = this.kafka!.consumer({ groupId });
      this.consumers.set(groupId, consumer);

      try {
        await consumer.connect();

        for (const topic of topics) {
          await consumer.subscribe({ topic, fromBeginning: false });
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
    this.logger.log(
      `✅ Kafka consumers started for groups: ${Object.values(KAFKA_CONSUMER_GROUPS).join(', ')}`,
    );
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
      this.logger.log('🛑 Kafka consumers stopped gracefully.');
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

    if (groupId === KAFKA_CONSUMER_GROUPS.DASHBOARD) {
      this.gateway.broadcast(OperationalEventName.KAFKA_EVENT, streamEvent);
      this.gateway.broadcast(
        OperationalEventName.KAFKA_HEALTH,
        this.health.getSnapshot(),
      );
    }

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
