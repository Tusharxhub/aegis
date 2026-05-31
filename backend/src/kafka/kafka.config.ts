import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
}

@Injectable()
export class KafkaConfigService {
  constructor(private readonly configService: ConfigService) {}

  getBrokers(): string[] {
    const configured = this.configService.get<string>('KAFKA_BROKER');
    if (!configured?.trim()) {
      throw new Error(
        'KAFKA_BROKER is not configured. Set KAFKA_BROKER=localhost:9092 for local development or KAFKA_BROKER=aegis-kafka:9092 inside Docker.',
      );
    }

    const brokers = configured
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);

    if (brokers.length === 0) {
      throw new Error(
        'KAFKA_BROKER is configured but empty. Provide at least one broker endpoint.',
      );
    }

    return brokers;
  }

  getClientId(): string {
    return (
      this.configService.get<string>('KAFKA_CLIENT_ID') ?? 'aegis-orchestrator'
    );
  }

  getConsumerRetryLimit(): number {
    return this.parsePositiveInteger('KAFKA_CONSUMER_RETRIES', 5);
  }

  getProducerRetryLimit(): number {
    return this.parsePositiveInteger('KAFKA_PRODUCER_RETRIES', 8);
  }

  isSslEnabled(): boolean {
    return parseBoolean(this.configService.get<string>('KAFKA_SSL'), false);
  }

  getEnvironmentLabel(): string {
    return this.configService.get<string>('NODE_ENV') ?? 'development';
  }

  getDiagnostics(): {
    readonly brokers: readonly string[];
    readonly clientId: string;
    readonly sslEnabled: boolean;
    readonly environment: string;
  } {
    return {
      brokers: this.getBrokers(),
      clientId: this.getClientId(),
      sslEnabled: this.isSslEnabled(),
      environment: this.getEnvironmentLabel(),
    };
  }

  private parsePositiveInteger(key: string, fallback: number): number {
    const rawValue = this.configService.get<string>(key);
    if (!rawValue?.trim()) {
      return fallback;
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${key} must be a positive integer.`);
    }

    return parsed;
  }
}