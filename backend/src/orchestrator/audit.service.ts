import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ServiceStatus,
  EventType,
  RemediationStatus,
  ActionType,
  RiskLevel,
} from '@prisma/client';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert a service container record in PostgreSQL.
   */
  async upsertService(containerId: string, name: string, imageName: string, status: ServiceStatus, exitCode?: number) {
    try {
      return await this.prisma.service.upsert({
        where: { containerId },
        update: {
          status,
          exitCode: exitCode ?? null,
          lastSeenAt: new Date(),
        },
        create: {
          containerId,
          name,
          imageName,
          status,
          exitCode: exitCode ?? null,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to upsert service ${name} in Postgres: ${msg}`);
      throw err;
    }
  }

  /**
   * Create an infrastructure incident log entry.
   */
  async logCrashEvent(serviceId: string, eventType: EventType, exitCode: number, logs: string, metadata: any) {
    try {
      return await this.prisma.infrastructureEvent.create({
        data: {
          serviceId,
          eventType,
          exitCode,
          rawLogs: logs,
          metadata: metadata || {},
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to create crash event: ${msg}`);
      throw err;
    }
  }

  /**
   * Log SentenceTransformer embeddings to PostgreSQL.
   */
  async logIncidentEmbedding(eventId: string, embedding: number[], incidentType: string) {
    try {
      return await this.prisma.incidentEmbedding.create({
        data: {
          eventId,
          embedding,
          incidentType,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to save incident embedding: ${msg}`);
      // Return null, embedding log failure is non-blocking for healing
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
      return await this.prisma.remediationPlan.create({
        data: {
          eventId,
          aiAnalysis,
          confidenceScore,
          suggestedAction,
          riskLevel,
          reasoning,
          status: RemediationStatus.PENDING,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to create remediation plan in DB: ${msg}`);
      throw err;
    }
  }

  /**
   * Update plan status.
   */
  async updatePlanStatus(planId: string, status: RemediationStatus, processingTimeMs?: number) {
    try {
      return await this.prisma.remediationPlan.update({
        where: { id: planId },
        data: {
          status,
          processingTimeMs: processingTimeMs ?? undefined,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to update remediation plan status: ${msg}`);
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
      return await this.prisma.actionExecution.create({
        data: {
          planId,
          actionTaken,
          isSuccessful,
          executionLogs,
          durationMs,
          errorMessage: errorMessage ?? null,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to save action execution log: ${msg}`);
      throw err;
    }
  }

  /**
   * Record CPU, RAM, and Disk performance checkpoints.
   */
  async logMetrics(cpuUsage: number, memoryUsage: number, diskUsage: number) {
    try {
      return await this.prisma.metricsSnapshot.create({
        data: {
          cpuUsage,
          memoryUsage,
          diskUsage,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to save metrics snapshot: ${msg}`);
    }
  }

  /**
   * Find the most recent event of a specific type for a service.
   */
  async getLatestEventForService(serviceId: string, eventType: EventType) {
    try {
      return await this.prisma.infrastructureEvent.findFirst({
        where: {
          serviceId,
          eventType,
        },
        orderBy: {
          timestamp: 'desc',
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to retrieve latest event for service ${serviceId}: ${msg}`);
      return null;
    }
  }
}
