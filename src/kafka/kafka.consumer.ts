import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Kafka, logLevel, type Consumer, type EachMessagePayload } from 'kafkajs';
import { KAFKA_CONSUMER_SUBSCRIPTIONS, type KafkaConsumerGroupId, type KafkaTopic } from './kafka.constants.js';
import { KafkaConfigService } from './kafka.config.js';
import { KafkaHealthService } from './kafka.health.js';
import { isKafkaEventEnvelope, isTopicPayload, type KafkaEventEnvelope } from './kafka.types.js';

/**
 * Supervised Kafka consumer lifecycle.
 *
 * On unexpected failure of consumer.run(), the supervisor:
 *   1. Disconnects the corrupted consumer safely
 *   2. Waits with exponential backoff + jitter
 *   3. Creates a fresh consumer instance
 *   4. Reconnects, resubscribes, and resumes consumption
 *
 * This continues indefinitely (KAFKA_RESTART_MAX_ATTEMPTS=0) or up to a
 * configured limit, and is prevented after intentional shutdown.
 */
@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private kafka: Kafka | null = null;
  private consumers = new Map<KafkaConsumerGroupId, Consumer>();
  private started = false;
  private stopping = false;

  /** Tracks whether a restart supervisor loop is already running per group. */
  private restartingGroups = new Set<KafkaConsumerGroupId>();

  constructor(private readonly kafkaConfig: KafkaConfigService, private readonly health: KafkaHealthService) {}

  async onModuleInit(): Promise<void> {
    try { await this.start(); } catch (error: unknown) {
      this.logger.warn(`[KAFKA] Consumers offline — will attempt recovery`);
      this.health.setError('Kafka is unreachable. Start infrastructure with npm run infra:up.');
      // Kick off recovery for each consumer group even if initial start fails
      this.startAllSupervisors();
    }
  }

  async onApplicationShutdown(): Promise<void> { await this.stop(); }

  private buildKafka(): Kafka {
    return new Kafka({
      clientId: this.kafkaConfig.getClientId(),
      brokers: this.kafkaConfig.getBrokers(),
      ssl: this.kafkaConfig.isSslEnabled(),
      logLevel: logLevel.ERROR,
      connectionTimeout: this.kafkaConfig.getConnectionTimeoutMs(),
      requestTimeout: this.kafkaConfig.getRequestTimeoutMs(),
      retry: { retries: this.kafkaConfig.getConnectionRetryLimit() },
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.stopping = false;
    this.kafka ??= this.buildKafka();
    this.health.setBroker(this.kafkaConfig.getBrokers());
    this.health.setStartupDiagnostics(this.kafkaConfig.getDiagnostics());
    this.logger.log(`[KAFKA] Connecting to broker: ${this.kafkaConfig.getBrokers().join(', ')}`);

    const consumerEntries = Object.entries(KAFKA_CONSUMER_SUBSCRIPTIONS) as Array<[KafkaConsumerGroupId, readonly KafkaTopic[]]>;

    const consumerStarts = consumerEntries.map(async ([groupId, topics]) => {
      await this.startConsumerGroup(groupId, topics);
    });

    await Promise.all(consumerStarts);
    this.started = true;

    // Only log "connected" when ALL consumers are actually connected
    const allConnected = consumerEntries.every(([gid]) => {
      const state = this.health.getConsumerGroupState(gid);
      return state?.connected === true;
    });
    if (allConnected) {
      this.logger.log('[KAFKA] Kafka consumers connected');
    } else {
      this.logger.warn('[KAFKA] Kafka consumers partially connected — supervisors active');
    }
  }

  /**
   * Start a single consumer group: connect, subscribe, run.
   */
  private async startConsumerGroup(groupId: KafkaConsumerGroupId, topics: readonly KafkaTopic[]): Promise<void> {
    this.health.markConsumerState(groupId, false, topics, 'CONNECTING');

    const consumer = this.kafka!.consumer({ groupId });
    this.consumers.set(groupId, consumer);

    await this.health.withRetry(`Kafka consumer connection for ${groupId}`, async () => { await consumer.connect(); return undefined; }, { retries: this.kafkaConfig.getConnectionRetryLimit(), delayMs: 250 });

    for (const topic of topics) {
      await this.health.withRetry(`Kafka consumer subscription for ${groupId} -> ${topic}`, async () => { await consumer.subscribe({ topic, fromBeginning: false }); return undefined; }, { retries: 3, delayMs: 150 });
    }

    this.health.markConsumerState(groupId, true, topics, 'CONNECTED', 0);
    this.logger.log(`[KAFKA] Consumer subscriptions restored for ${groupId}`);

    void consumer.run({
      autoCommit: true,
      eachMessage: (message: EachMessagePayload): Promise<void> => Promise.resolve(this.handleMessage(groupId, message)),
    }).catch((error: unknown) => {
      if (this.stopping) return;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[KAFKA] Consumer stopped unexpectedly for group ${groupId}: ${message}`);
      this.health.markConsumerState(groupId, false, topics, 'RESTARTING');
      this.health.setError(message);
      // Launch the supervised restart loop
      void this.supervisedRestart(groupId, topics);
    });
  }

  /**
   * Supervised restart loop with exponential backoff + jitter.
   * Ensures only one restart loop runs per consumer group.
   * Does NOT restart after intentional shutdown.
   */
  private async supervisedRestart(groupId: KafkaConsumerGroupId, topics: readonly KafkaTopic[]): Promise<void> {
    if (this.stopping) return;
    if (this.restartingGroups.has(groupId)) return; // Already restarting
    this.restartingGroups.add(groupId);

    const initialDelayMs = this.kafkaConfig.getRestartInitialDelayMs();
    const maxDelayMs = this.kafkaConfig.getRestartMaxDelayMs();
    const maxAttempts = this.kafkaConfig.getRestartMaxAttempts(); // 0 = unlimited
    let attempt = 0;

    while (!this.stopping) {
      attempt++;

      if (maxAttempts > 0 && attempt > maxAttempts) {
        this.logger.error(`[KAFKA] Consumer group ${groupId} exceeded max restart attempts (${maxAttempts}). Giving up.`);
        this.health.markConsumerState(groupId, false, topics, 'DISCONNECTED', attempt, `Exceeded max restart attempts (${maxAttempts})`);
        break;
      }

      // Exponential backoff with jitter
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = Math.floor(Math.random() * 500);
      const totalDelay = delay + jitter;

      this.logger.warn(`[KAFKA] Restarting consumer in ${totalDelay}ms (group=${groupId}, attempt=${attempt})`);
      this.health.markConsumerState(groupId, false, topics, 'RESTARTING', attempt);

      await this.sleep(totalDelay);

      if (this.stopping) break;

      try {
        // Step 1: Safely disconnect the old consumer
        const oldConsumer = this.consumers.get(groupId);
        if (oldConsumer) {
          try { await oldConsumer.disconnect(); } catch { /* ignore disconnect errors during recovery */ }
          this.consumers.delete(groupId);
        }

        // Step 2: Build a fresh Kafka client to avoid stale state
        this.kafka = this.buildKafka();

        // Step 3: Start a fresh consumer group
        await this.startConsumerGroup(groupId, topics);
        this.logger.log(`[KAFKA] Consumer reconnected for group ${groupId} after ${attempt} restart attempt(s)`);
        this.health.setError(null);
        break; // Successfully restarted
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[KAFKA] Restart attempt ${attempt} failed for ${groupId}: ${message}`);
        this.health.markConsumerState(groupId, false, topics, 'RESTARTING', attempt, message);
      }
    }

    this.restartingGroups.delete(groupId);
  }

  /**
   * Kick off supervisor loops for all consumer groups (used when initial start fails).
   */
  private startAllSupervisors(): void {
    const consumerEntries = Object.entries(KAFKA_CONSUMER_SUBSCRIPTIONS) as Array<[KafkaConsumerGroupId, readonly KafkaTopic[]]>;
    for (const [groupId, topics] of consumerEntries) {
      void this.supervisedRestart(groupId, topics);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.logger.log('[KAFKA] Stopping consumer supervisors');

    if (!this.started && this.consumers.size === 0) return;
    this.logger.log('[KAFKA] Disconnecting consumers...');

    // Mark all consumers as STOPPING
    for (const [groupId, _consumer] of this.consumers.entries()) {
      const topics = KAFKA_CONSUMER_SUBSCRIPTIONS[groupId];
      this.health.markConsumerState(groupId, false, topics, 'STOPPING');
    }

    const disconnectJobs = Array.from(this.consumers.entries()).map(async ([groupId, consumer]) => {
      try { await consumer.disconnect(); this.health.markConsumerState(groupId, false, KAFKA_CONSUMER_SUBSCRIPTIONS[groupId], 'DISCONNECTED'); } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Kafka consumer group ${groupId} disconnect warning: ${message}`);
      }
    });
    await Promise.allSettled(disconnectJobs);
    if (disconnectJobs.length > 0) this.logger.log('[KAFKA] Kafka consumers stopped gracefully');
    this.consumers.clear();
    this.started = false;
  }

  private handleMessage(groupId: KafkaConsumerGroupId, message: EachMessagePayload): void {
    const raw = message.message.value?.toString('utf8');
    if (!raw) return;

    let parsed: unknown;
    try { parsed = JSON.parse(raw) as unknown; } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Malformed Kafka event on ${message.topic} (${groupId}): ${messageText}`);
      return;
    }

    if (!isKafkaEventEnvelope(parsed)) {
      this.logger.warn(`Rejected Kafka event without valid envelope on topic ${message.topic} (group ${groupId}).`);
      return;
    }

    if (!isTopicPayload(message.topic as KafkaTopic, parsed.payload)) {
      this.logger.warn(`Rejected Kafka event with invalid payload structure on topic ${message.topic} (group ${groupId}).`);
      return;
    }

    this.health.markConsumed(parsed.timestamp);
    this.logger.debug(`[${groupId}] ${message.topic} :: ${parsed.eventType} :: ${parsed.correlationId}`);
  }

  private summarizePayload(payload: Record<string, unknown>): string {
    const keys = Object.keys(payload).slice(0, 4);
    if (keys.length === 0) return '{}';
    const summary: Record<string, unknown> = {};
    for (const key of keys) summary[key] = payload[key];
    return JSON.stringify(summary);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
