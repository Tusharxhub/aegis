import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service.js';
import { KafkaProducerService } from '../kafka/kafka.producer.js';
import type { KafkaHealthSnapshot } from '../kafka/kafka.health.js';

/**
 * OrchestratorController — Infrastructure status and health endpoints.
 *
 * This is a headless backend platform. These endpoints are for:
 * - Infrastructure observability (liveness, readiness)
 * - Kafka pipeline health
 * - Incident ledger inspection (operator tooling)
 *
 * There are no frontend-facing APIs. No client-side state is served here.
 */
@Controller('orchestrator')
export class OrchestratorController {
  private readonly logger = new Logger(OrchestratorController.name);

  constructor(
    private readonly mongoService: MongoService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  /**
   * Returns current Kafka producer health snapshot.
   */
  @Get('health/kafka')
  getKafkaHealth(): KafkaHealthSnapshot {
    return this.kafkaProducer.getHealthSnapshot();
  }

  /**
   * Returns the last 50 remediation plans from the infrastructure ledger.
   * Intended for operator inspection, not frontend consumption.
   */
  @Get('ledger/incidents')
  async getRecentIncidents(): Promise<unknown[]> {
    try {
      return await this.mongoService.PlanModel.find()
        .sort({ createdAt: -1 })
        .limit(50)
        .populate({
          path: 'event',
          populate: { path: 'service' },
        })
        .lean()
        .exec();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to retrieve incident ledger: ${message}`);
      throw new InternalServerErrorException(
        `Ledger query failed: ${message}`,
      );
    }
  }

  /**
   * Returns the current infrastructure service registry.
   */
  @Get('ledger/services')
  async getServiceRegistry(): Promise<unknown[]> {
    try {
      return await this.mongoService.ServiceModel.find()
        .sort({ lastSeenAt: -1 })
        .lean()
        .exec();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to retrieve service registry: ${message}`);
      throw new InternalServerErrorException(
        `Service registry query failed: ${message}`,
      );
    }
  }
}
