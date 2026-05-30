import { Injectable, Logger } from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service.js';
import {
  ServiceStatus,
  EventType,
  RemediationStatus,
  ActionType,
  RiskLevel,
} from '../common/interfaces/db-types.js';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly mongoService: MongoService) {}

  /**
   * Upsert a service container record in MongoDB.
   */
  async upsertService(
    containerId: string,
    name: string,
    imageName: string,
    status: ServiceStatus,
    exitCode?: number,
  ) {
    try {
      return await this.mongoService.ServiceModel.findOneAndUpdate(
        { containerId },
        {
          $set: {
            status,
            exitCode: exitCode ?? null,
            lastSeenAt: new Date(),
          },
          $setOnInsert: {
            name,
            imageName,
            restartCount: 0,
          },
        },
        { upsert: true, new: true },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to upsert service ${name} in MongoDB: ${msg}`);
      throw err;
    }
  }

  /**
   * Create an infrastructure incident log entry.
   */
  async logCrashEvent(
    serviceId: string,
    eventType: EventType,
    exitCode: number,
    logs: string,
    metadata: any,
  ) {
    try {
      return await this.mongoService.EventModel.create({
        service: serviceId,
        eventType,
        exitCode,
        rawLogs: logs,
        metadata: metadata || {},
        timestamp: new Date(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to create crash event in MongoDB: ${msg}`);
      throw err;
    }
  }

  /**
   * Log SentenceTransformer embeddings to MongoDB.
   */
  async logIncidentEmbedding(
    eventId: string,
    embedding: number[],
    incidentType: string,
  ) {
    try {
      return await this.mongoService.EmbeddingModel.findOneAndUpdate(
        { event: eventId },
        {
          $set: {
            vector: embedding,
            incidentType,
          },
        },
        { upsert: true, new: true },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to save incident embedding in MongoDB: ${msg}`);
      return null;
    }
  }

  /**
   * Record a remediation plan proposed by the custom AI engine.
   */
  async logRemediationPlan(
    eventId: string,
    aiAnalysis: string,
    confidenceScore: number,
    suggestedAction: ActionType,
    riskLevel: RiskLevel,
    reasoning: string,
  ) {
    try {
      return await this.mongoService.PlanModel.create({
        event: eventId,
        analysis: aiAnalysis,
        confidenceScore,
        suggestedAction,
        riskLevel,
        reasoning,
        status: RemediationStatus.PENDING,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to create remediation plan in MongoDB: ${msg}`);
      throw err;
    }
  }

  /**
   * Update plan status.
   */
  async updatePlanStatus(
    planId: string,
    status: RemediationStatus,
    processingTimeMs?: number,
  ) {
    try {
      return await this.mongoService.PlanModel.findByIdAndUpdate(
        planId,
        {
          $set: {
            status,
            processingTimeMs: processingTimeMs ?? undefined,
          },
        },
        { new: true },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to update remediation plan status in MongoDB: ${msg}`,
      );
    }
  }

  /**
   * Log details of a container self-healing execution step.
   */
  async logActionExecution(
    planId: string,
    actionTaken: string,
    isSuccessful: boolean,
    executionLogs: string,
    durationMs: number,
    errorMessage?: string,
  ) {
    try {
      return await this.mongoService.ExecutionModel.create({
        plan: planId,
        actionTaken,
        isSuccessful,
        executionLogs,
        durationMs,
        errorMessage: errorMessage ?? null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to save action execution log in MongoDB: ${msg}`,
      );
      throw err;
    }
  }

  /**
   * Record CPU, RAM, and Disk performance checkpoints.
   */
  async logMetrics(cpuUsage: number, memoryUsage: number, diskUsage: number) {
    try {
      return await this.mongoService.MetricsModel.create({
        cpuUsage,
        memoryUsage,
        diskUsage,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to save metrics snapshot in MongoDB: ${msg}`);
    }
  }

  /**
   * Find the most recent event of a specific type for a service.
   */
  async getLatestEventForService(serviceId: string, eventType: EventType) {
    try {
      return await this.mongoService.EventModel.findOne({
        service: serviceId,
        eventType,
      })
        .sort({ timestamp: -1 })
        .exec();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to retrieve latest event for service ${serviceId}: ${msg}`,
      );
      return null;
    }
  }
}
