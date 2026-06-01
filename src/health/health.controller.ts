import { Controller, Get } from '@nestjs/common';
import { KafkaProducerService } from '../kafka/kafka.producer.js';

@Controller()
export class HealthController {
  private readonly startTime = Date.now();

  constructor(private readonly kafkaProducer: KafkaProducerService) {}

  /**
   * Root endpoint — basic liveness probe.
   */
  @Get()
  root() {
    return {
      service: 'aegis-control-plane',
      status: 'healthy',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Health check endpoint for Docker/K8s health probes.
   */
  @Get('health')
  health() {
    const kafka = this.kafkaProducer.getHealthSnapshot();
    return {
      status: 'healthy',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      kafka: {
        producerConnected: kafka.producerConnected,
        lastError: kafka.lastError,
        consumerGroups: kafka.consumerGroups.length,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
