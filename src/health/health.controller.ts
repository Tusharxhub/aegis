import { Controller, Get } from '@nestjs/common';
import { KafkaProducerService } from '../kafka/kafka.producer.js';
import { AiAgentService } from '../ai-agent/ai-agent.service.js';

@Controller()
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    private readonly kafkaProducer: KafkaProducerService,
    private readonly aiAgent: AiAgentService,
  ) {}

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
   * Reports AI runtime status separately — never treats fallback as healthy.
   */
  @Get('health')
  health() {
    const kafka = this.kafkaProducer.getHealthSnapshot();
    const aiAvailable = this.aiAgent.isAiEngineAvailable();
    const kafkaHealthy = kafka.producerConnected && kafka.consumerState === 'CONNECTED';

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const degradedReasons: string[] = [];

    if (!aiAvailable) {
      status = 'degraded';
      degradedReasons.push('AI engine unavailable — fallback diagnosis active');
    }

    if (!kafkaHealthy) {
      status = 'degraded';
      degradedReasons.push(`Kafka ${kafka.consumerState === 'RESTARTING' ? 'recovering' : 'unavailable'}`);
    }

    return {
      status,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      kafka: {
        producerConnected: kafka.producerConnected,
        consumerState: kafka.consumerState,
        consumerGroups: kafka.consumerGroups.length,
        restartAttempts: kafka.restartAttempts,
        lastError: kafka.lastError,
      },
      ai: {
        engineAvailable: aiAvailable,
        mode: aiAvailable ? 'live' : 'fallback',
        ...(aiAvailable ? {} : { warning: 'AI engine is offline — only safe fallback diagnosis is active. Automatic remediation is disabled.' }),
      },
      ...(degradedReasons.length > 0 ? { degradedReasons } : {}),
      timestamp: new Date().toISOString(),
    };
  }
}
