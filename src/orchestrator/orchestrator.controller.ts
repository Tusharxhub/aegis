import { Controller, Get, Post, Param, UseGuards, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { InternalTokenGuard } from '../common/guards/internal-token.guard.js';
import { DockerService } from '../docker/docker.service.js';
import { AuditService } from './audit.service.js';
import { KafkaProducerService } from '../kafka/kafka.producer.js';

/**
 * OrchestratorController — Internal API for operational inspection.
 * Dangerous actions (restart) are protected by InternalTokenGuard.
 */
@Controller('orchestrator')
export class OrchestratorController {
  private readonly logger = new Logger(OrchestratorController.name);

  constructor(
    private readonly dockerService: DockerService,
    private readonly auditService: AuditService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  /**
   * List all containers visible to the Docker daemon.
   */
  @Get('containers')
  async listContainers() {
    const containers = await this.dockerService.listContainers();
    return { status: 'ok', count: containers.length, containers: containers.map((c) => ({ id: c.Id, names: c.Names, image: c.Image, state: c.State, status: c.Status })) };
  }

  /**
   * Inspect a specific container by ID.
   */
  @Get('containers/:id')
  async inspectContainer(@Param('id') id: string) {
    const info = await this.dockerService.inspectContainer(id);
    return { status: 'ok', container: { id: info.Id, name: info.Name, image: info.Config.Image, state: info.State } };
  }

  /**
   * DANGEROUS: Restart a container. Protected by internal token.
   */
  @Post('containers/:id/restart')
  @UseGuards(InternalTokenGuard)
  @HttpCode(HttpStatus.OK)
  async restartContainer(@Param('id') id: string) {
    this.logger.warn(`Manual container restart requested for: ${id}`);
    await this.dockerService.restartContainer(id);
    return { status: 'ok', message: `Container ${id} restart initiated.` };
  }

  /**
   * Get Kafka health snapshot.
   */
  @Get('health/kafka')
  getKafkaHealth() {
    const snapshot = this.kafkaProducer.getHealthSnapshot();
    const consumersConnected = snapshot.consumerGroups.length > 0 && snapshot.consumerGroups.every(c => c.connected);
    const isHealthy = snapshot.producerConnected && consumersConnected;

    if (!isHealthy) {
      return {
        status: 'degraded',
        broker: snapshot.broker.join(', '),
        producerConnected: snapshot.producerConnected,
        consumersConnected,
        message: 'Kafka is unreachable. Start infrastructure with npm run infra:up.',
      };
    }

    return {
      status: 'healthy',
      broker: snapshot.broker.join(', '),
      producerConnected: snapshot.producerConnected,
      consumersConnected,
    };
  }
}
