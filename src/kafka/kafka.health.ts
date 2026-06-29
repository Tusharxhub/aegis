import { Injectable, Logger } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import type { KafkaConsumerGroupId } from './kafka.constants.js';

export type ConsumerConnectionState =
  | 'CONNECTED'
  | 'CONNECTING'
  | 'RESTARTING'
  | 'DEGRADED'
  | 'DISCONNECTED'
  | 'STOPPING';

export interface KafkaConsumerHealthState {
  readonly groupId: KafkaConsumerGroupId;
  readonly connected: boolean;
  readonly state: ConsumerConnectionState;
  readonly topics: readonly string[];
  readonly restartAttempts: number;
  readonly lastError?: string;
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
  readonly connectionRetryLimit: number;
  readonly consumerRetryLimit: number;
  readonly producerRetryLimit: number;
  readonly producerMaxInFlightRequests: number;
  readonly initialRetryTimeMs: number;
  readonly connectionTimeoutMs: number;
  readonly requestTimeoutMs: number;
}

export interface KafkaHealthSnapshot {
  readonly broker: string[];
  readonly producerConnected: boolean;
  readonly consumerGroups: readonly KafkaConsumerHealthState[];
  readonly consumerState: ConsumerConnectionState;
  readonly restartAttempts: number;
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
    this.logger.log(
      `[KAFKA] Retry policies active :: connection=${diagnostics.connectionRetryLimit} consumer=${diagnostics.consumerRetryLimit} producer=${diagnostics.producerRetryLimit} initialRetryMs=${diagnostics.initialRetryTimeMs}`,
    );
    this.logger.log(
      `[KAFKA] Idempotent producer enabled :: maxInFlightRequests=${diagnostics.producerMaxInFlightRequests} connectionTimeoutMs=${diagnostics.connectionTimeoutMs} requestTimeoutMs=${diagnostics.requestTimeoutMs}`,
    );
  }

  setClusterMetadata(cluster: KafkaClusterMetadata): void {
    this.cluster = cluster;
    this.logger.log(
      `[KAFKA] Broker metadata loaded :: clusterId=${cluster.clusterId ?? 'unknown'} controller=${cluster.controllerId ?? 'unknown'} brokers=${cluster.brokers.join(', ')}`,
    );
  }

  markProducerConnected(): void {
    this.producerConnected = true;
    this.logger.log('[KAFKA] Producer connected');
  }

  markProducerDisconnected(): void {
    this.producerConnected = false;
  }

  markConsumerState(
    groupId: KafkaConsumerGroupId,
    connected: boolean,
    topics: readonly string[],
    state?: ConsumerConnectionState,
    restartAttempts?: number,
    lastError?: string,
  ): void {
    const resolvedState: ConsumerConnectionState =
      state ?? (connected ? 'CONNECTED' : 'DISCONNECTED');
    const resolvedRestartAttempts =
      restartAttempts ?? this.consumerGroups.get(groupId)?.restartAttempts ?? 0;
    const entry: KafkaConsumerHealthState = {
      groupId,
      connected,
      state: resolvedState,
      topics,
      restartAttempts: resolvedRestartAttempts,
      ...(lastError !== undefined ? { lastError } : {}),
    };
    this.consumerGroups.set(groupId, entry);
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

  getConsumerGroupState(
    groupId: KafkaConsumerGroupId,
  ): KafkaConsumerHealthState | undefined {
    return this.consumerGroups.get(groupId);
  }

  getOverallConsumerState(): ConsumerConnectionState {
    const states = Array.from(this.consumerGroups.values());
    if (states.length === 0) return 'DISCONNECTED';
    if (states.some((s) => s.state === 'STOPPING')) return 'STOPPING';
    if (states.every((s) => s.state === 'CONNECTED')) return 'CONNECTED';
    if (states.some((s) => s.state === 'RESTARTING')) return 'RESTARTING';
    if (states.some((s) => s.state === 'CONNECTING')) return 'CONNECTING';
    if (states.some((s) => s.state === 'DEGRADED')) return 'DEGRADED';
    return 'DISCONNECTED';
  }

  getTotalRestartAttempts(): number {
    let total = 0;
    for (const state of this.consumerGroups.values()) {
      total += state.restartAttempts;
    }
    return total;
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
      consumerState: this.getOverallConsumerState(),
      restartAttempts: this.getTotalRestartAttempts(),
      lastPublishedAt: this.lastPublishedAt,
      lastConsumedAt: this.lastConsumedAt,
      lastError: this.lastError,
      cluster: this.cluster,
      startup: this.startup,
    };
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
