import { Injectable, Logger } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import type { KafkaConsumerGroupId } from './kafka.constants.js';

export interface KafkaConsumerHealthState {
  readonly groupId: KafkaConsumerGroupId;
  readonly connected: boolean;
  readonly topics: readonly string[];
}

export interface KafkaClusterMetadata {
  readonly clusterId: string | null;
  readonly controllerId: number | null;
  readonly brokers: readonly string[];
}

export interface KafkaStartupDiagnostics {
  readonly brokers: readonly string[];
  readonly clientId: string;
  readonly sslEnabled: boolean;
  readonly environment: string;
}

export interface KafkaHealthSnapshot {
  readonly broker: string[];
  readonly producerConnected: boolean;
  readonly consumerGroups: readonly KafkaConsumerHealthState[];
  readonly lastPublishedAt: string | null;
  readonly lastConsumedAt: string | null;
  readonly lastError: string | null;
  readonly cluster: KafkaClusterMetadata | null;
  readonly startup: KafkaStartupDiagnostics | null;
}

@Injectable()
export class KafkaHealthService {
  private readonly logger = new Logger(KafkaHealthService.name);
  private broker: string[] = [];
  private producerConnected = false;
  private consumerGroups = new Map<
    KafkaConsumerGroupId,
    KafkaConsumerHealthState
  >();
  private lastPublishedAt: string | null = null;
  private lastConsumedAt: string | null = null;
  private lastError: string | null = null;
  private cluster: KafkaClusterMetadata | null = null;
  private startup: KafkaStartupDiagnostics | null = null;

  setBroker(broker: string[]): void {
    this.broker = broker;
  }

  setStartupDiagnostics(diagnostics: KafkaStartupDiagnostics): void {
    this.startup = diagnostics;
    this.logger.log(
      `[KAFKA] Startup diagnostics :: broker=${diagnostics.brokers.join(', ')} client=${diagnostics.clientId} ssl=${diagnostics.sslEnabled} env=${diagnostics.environment}`,
    );
  }

  setClusterMetadata(cluster: KafkaClusterMetadata): void {
    this.cluster = cluster;
    this.logger.log(
      `[KAFKA] Broker metadata :: clusterId=${cluster.clusterId ?? 'unknown'} controller=${cluster.controllerId ?? 'unknown'} brokers=${cluster.brokers.join(', ')}`,
    );
  }

  markProducerConnected(): void {
    this.producerConnected = true;
  }

  markProducerDisconnected(): void {
    this.producerConnected = false;
  }

  markConsumerState(
    groupId: KafkaConsumerGroupId,
    connected: boolean,
    topics: readonly string[],
  ): void {
    this.consumerGroups.set(groupId, { groupId, connected, topics });
  }

  markPublished(timestamp: string): void {
    this.lastPublishedAt = timestamp;
  }

  markConsumed(timestamp: string): void {
    this.lastConsumedAt = timestamp;
  }

  setError(message: string | null): void {
    this.lastError = message;
  }

  async withRetry<T>(
    operationName: string,
    operation: () => Promise<T>,
    options?: {
      readonly retries?: number;
      readonly delayMs?: number;
      readonly backoffFactor?: number;
    },
  ): Promise<T> {
    const retries = options?.retries ?? 5;
    const baseDelayMs = options?.delayMs ?? 300;
    const backoffFactor = options?.backoffFactor ?? 2;

    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await operation();
        this.setError(null);
        return result;
      } catch (error: unknown) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);

        if (attempt >= retries) {
          const finalMessage = `${operationName} failed after ${retries} attempts: ${message}`;
          this.setError(finalMessage);
          this.logger.error(`[KAFKA] ${finalMessage}`);
          throw error instanceof Error ? error : new Error(finalMessage);
        }

        const delayMs = Math.min(
          baseDelayMs * Math.pow(backoffFactor, attempt - 1),
          5_000,
        );

        this.logger.warn(
          `[KAFKA] ${operationName} failed on attempt ${attempt}/${retries}: ${message}. Retrying in ${delayMs}ms.`,
        );

        await this.sleep(delayMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`${operationName} failed unexpectedly.`);
  }

  async captureClusterMetadata(kafka: Kafka): Promise<void> {
    const admin = kafka.admin();

    try {
      await admin.connect();
      const metadata = await admin.describeCluster();

      this.setClusterMetadata({
        clusterId: metadata.clusterId ?? null,
        controllerId:
          typeof metadata.controller === 'number' ? metadata.controller : null,
        brokers: metadata.brokers.map(
          (broker) => `${broker.host}:${broker.port}`,
        ),
      });
    } finally {
      await admin.disconnect().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[KAFKA] Broker metadata disconnect warning: ${message}`,
        );
      });
    }
  }

  getSnapshot(): KafkaHealthSnapshot {
    return {
      broker: this.broker,
      producerConnected: this.producerConnected,
      consumerGroups: Array.from(this.consumerGroups.values()),
      lastPublishedAt: this.lastPublishedAt,
      lastConsumedAt: this.lastConsumedAt,
      lastError: this.lastError,
      cluster: this.cluster,
      startup: this.startup,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
