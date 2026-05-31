import { Injectable } from '@nestjs/common';
import type { KafkaConsumerGroupId } from './kafka.constants.js';

export interface KafkaConsumerHealthState {
  readonly groupId: KafkaConsumerGroupId;
  readonly connected: boolean;
  readonly topics: readonly string[];
}

export interface KafkaHealthSnapshot {
  readonly broker: string[];
  readonly producerConnected: boolean;
  readonly consumerGroups: readonly KafkaConsumerHealthState[];
  readonly lastPublishedAt: string | null;
  readonly lastConsumedAt: string | null;
  readonly lastError: string | null;
}

@Injectable()
export class KafkaHealthService {
  private broker: string[] = [];
  private producerConnected = false;
  private consumerGroups = new Map<KafkaConsumerGroupId, KafkaConsumerHealthState>();
  private lastPublishedAt: string | null = null;
  private lastConsumedAt: string | null = null;
  private lastError: string | null = null;

  setBroker(broker: string[]): void {
    this.broker = broker;
  }

  markProducerConnected(): void {
    this.producerConnected = true;
  }

  markProducerDisconnected(): void {
    this.producerConnected = false;
  }

  markConsumerState(groupId: KafkaConsumerGroupId, connected: boolean, topics: readonly string[]): void {
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

  getSnapshot(): KafkaHealthSnapshot {
    return {
      broker: this.broker,
      producerConnected: this.producerConnected,
      consumerGroups: Array.from(this.consumerGroups.values()),
      lastPublishedAt: this.lastPublishedAt,
      lastConsumedAt: this.lastConsumedAt,
      lastError: this.lastError,
    };
  }
}
