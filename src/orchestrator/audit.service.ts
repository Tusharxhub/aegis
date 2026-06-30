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
      const setFields: Record<string, unknown> = {
        status,
        exitCode: exitCode ?? null,
        lastSeenAt: new Date(),
      };

      const setOnInsert: Record<string, unknown> = {
        name,
        imageName,
        restartCount: 0,
        lastRemediationAt: null,
        totalCrashCount: 0,
        monitoringEnabled: true,
      };

      const update: Record<string, unknown> = {
        $set: setFields,
        $setOnInsert: setOnInsert,
      };

      // Track crash count and last crash time
      if (status === ServiceStatus.CRASHED) {
        update.$inc = { totalCrashCount: 1 };
        setFields.lastCrashAt = new Date();
      }

      return await this.mongoService.ServiceModel.findOneAndUpdate(
        { containerId },
        update,
        { upsert: true, returnDocument: 'after' },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to upsert service ${name} in MongoDB: ${msg}`);
      throw err;
    }
  }

  /**
   * Increment the restart count for a service and update lastRemediationAt.
   */
  async incrementRestartCount(containerId: string): Promise<void> {
    try {
      await this.mongoService.ServiceModel.findOneAndUpdate(
        { containerId },
        {
          $inc: { restartCount: 1 },
          $set: { lastRemediationAt: new Date() },
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to increment restart count for ${containerId}: ${msg}`,
      );
    }
  }

  /**
   * Get the number of restarts for a container within a time window (ms).
   *
   * If the last remediation is outside the window, the counter is stale
   * and we return 0 (the restarts are old enough to not matter).
   * If the last remediation is inside the window, we return the cumulative
   * restartCount, which tracks all restarts since the counter was last
   * reset (it is reset when the window expires and a new crash occurs).
   */
  async getRestartCount(
    containerId: string,
    windowMs: number,
  ): Promise<number> {
    try {
      const since = new Date(Date.now() - windowMs);
      const doc = await this.mongoService.ServiceModel.findOne({ containerId })
        .select('restartCount lastRemediationAt')
        .lean()
        .exec();

      if (!doc || !doc.lastRemediationAt) return 0;
      if (doc.lastRemediationAt < since) return 0;
      return doc.restartCount ?? 0;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to get restart count for ${containerId}: ${msg}`,
      );
      return 0;
    }
  }

  /**
   * Reset the restart count for a container (called when the restart
   * window has fully elapsed and a fresh cycle begins).
   */
  async resetRestartCount(containerId: string): Promise<void> {
    try {
      await this.mongoService.ServiceModel.findOneAndUpdate(
        { containerId },
        { $set: { restartCount: 0 } },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to reset restart count for ${containerId}: ${msg}`,
      );
    }
  }

  /**
   * Update service status directly.
   */
  async updateServiceStatus(
    containerId: string,
    status: ServiceStatus,
  ): Promise<void> {
    try {
      await this.mongoService.ServiceModel.findOneAndUpdate(
        { containerId },
        { $set: { status, lastSeenAt: new Date() } },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to update service status for ${containerId}: ${msg}`,
      );
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
    metadata: Record<string, unknown>,
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
        { upsert: true, returnDocument: 'after' },
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
        { returnDocument: 'after' },
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

  /**
   * Get a service document by container ID.
   */
  async getServiceByContainerId(containerId: string) {
    try {
      return await this.mongoService.ServiceModel.findOne({ containerId })
        .lean()
        .exec();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to get service for ${containerId}: ${msg}`);
      return null;
    }
  }

  /**
   * Get the number of crash events for a service within a time window.
   */
  async getRecentCrashCount(
    serviceId: string,
    windowMs: number,
  ): Promise<number> {
    try {
      const since = new Date(Date.now() - windowMs);
      return await this.mongoService.EventModel.countDocuments({
        service: serviceId,
        timestamp: { $gte: since },
      }).exec();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to get recent crash count for ${serviceId}: ${msg}`,
      );
      return 0;
    }
  }
}
