import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { InternalTokenGuard } from '../common/guards/internal-token.guard.js';
import { DockerService } from '../docker/docker.service.js';
import { AuditService } from './audit.service.js';
import { KafkaProducerService } from '../kafka/kafka.producer.js';
import { MongoService } from '../mongo/mongo.service.js';
import { DYNAMIC_IGNORED_CONTAINERS } from '../common/constants/index.js';

/**
 * Validates that a string looks like a Docker container ID (hex string, 12 or 64 chars)
 * or a container name (alphanumeric with hyphens/underscores/dots).
 */
function isValidContainerRef(id: string): boolean {
  // Docker short ID (12 hex) or full ID (64 hex)
  if (/^[a-f0-9]{12,64}$/i.test(id)) return true;
  // Container name: alphanumeric, hyphens, underscores, dots, slashes
  if (/^[a-zA-Z0-9][a-zA-Z0-9._\-/]{0,127}$/.test(id)) return true;
  return false;
}

/**
 * Validates that a string is a valid MongoDB ObjectId.
 */
function isValidObjectId(id: string): boolean {
  return Types.ObjectId.isValid(id) && new Types.ObjectId(id).toString() === id;
}

/**
 * OrchestratorController — Internal API for operational inspection.
 * Dangerous actions (restart) are protected by InternalTokenGuard.
 */
@ApiTags('orchestrator')
@Controller('orchestrator')
export class OrchestratorController {
  private readonly logger = new Logger(OrchestratorController.name);

  constructor(
    private readonly dockerService: DockerService,
    private readonly auditService: AuditService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly mongoService: MongoService,
  ) {}

  /**
   * List all containers visible to the Docker daemon.
   */
  @Get('containers')
  @ApiOperation({ summary: 'List all Docker containers' })
  async listContainers() {
    const containers = await this.dockerService.listContainers();
    return {
      status: 'ok',
      count: containers.length,
      containers: containers.map((c) => ({
        id: c.Id,
        names: c.Names,
        image: c.Image,
        state: c.State,
        status: c.Status,
      })),
    };
  }

  /**
   * Inspect a specific container by ID.
   */
  @Get('containers/:id')
  async inspectContainer(@Param('id') id: string) {
    if (!isValidContainerRef(id)) {
      throw new BadRequestException('Invalid container ID format.');
    }
    const info = await this.dockerService.inspectContainer(id);
    return {
      status: 'ok',
      container: {
        id: info.Id,
        name: info.Name,
        image: info.Config.Image,
        state: info.State,
      },
    };
  }

  /**
   * Get recent crash logs for a container.
   */
  @Get('containers/:id/logs')
  async getContainerLogs(@Param('id') id: string) {
    if (!isValidContainerRef(id)) {
      throw new BadRequestException('Invalid container ID format.');
    }
    try {
      const logs = await this.dockerService.getContainerLogs(id);
      return { status: 'ok', logs };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to get logs for container: ${message}`);
      return { status: 'error', message: 'Failed to retrieve logs.', logs: '' };
    }
  }

  /**
   * DANGEROUS: Restart a container. Protected by internal token.
   */
  @Post('containers/:id/restart')
  @UseGuards(InternalTokenGuard)
  @HttpCode(HttpStatus.OK)
  async restartContainer(@Param('id') id: string) {
    if (!isValidContainerRef(id)) {
      throw new BadRequestException('Invalid container ID format.');
    }
    this.logger.warn(`Manual container restart requested for: ${id}`);
    await this.dockerService.restartContainer(id);
    return { status: 'ok', message: 'Container restart initiated.' };
  }

  /**
   * Get Kafka health snapshot.
   */
  @Get('health/kafka')
  getKafkaHealth() {
    const snapshot = this.kafkaProducer.getHealthSnapshot();
    const consumersConnected =
      snapshot.consumerGroups.length > 0 &&
      snapshot.consumerGroups.every((c) => c.connected);
    const consumerState = snapshot.consumerState;
    const restartAttempts = snapshot.restartAttempts;
    const isHealthy =
      snapshot.producerConnected &&
      consumersConnected &&
      consumerState === 'CONNECTED';

    if (isHealthy) {
      return {
        status: 'healthy',
        producerConnected: snapshot.producerConnected,
        consumersConnected,
        consumerState,
        restartAttempts,
      };
    }

    const isRecovering =
      consumerState === 'RESTARTING' || consumerState === 'CONNECTING';
    return {
      status: isRecovering ? 'degraded' : 'unhealthy',
      producerConnected: snapshot.producerConnected,
      consumersConnected,
      consumerState,
      restartAttempts,
      message: isRecovering
        ? 'Kafka recovery is in progress.'
        : 'Kafka is unreachable. Start infrastructure with npm run infra:up.',
      ...(snapshot.lastError ? { lastError: snapshot.lastError } : {}),
    };
  }

  /**
   * List all stored incidents with optional filtering.
   * Query params: container, type, limit, offset
   */
  @Get('incidents')
  async listIncidents(
    @Query('container') container?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    try {
      const query: Record<string, unknown> = {};
      if (container) query.service = container;
      if (type) query.eventType = type;

      const limitNum = Math.min(parseInt(limit ?? '50', 10) || 50, 100);
      const offsetNum = parseInt(offset ?? '0', 10) || 0;

      const events = await this.mongoService.EventModel.find(query)
        .sort({ timestamp: -1 })
        .skip(offsetNum)
        .limit(limitNum)
        .lean()
        .exec();

      const total =
        await this.mongoService.EventModel.countDocuments(query).exec();

      return {
        status: 'ok',
        count: events.length,
        total,
        incidents: events.map((e: Record<string, unknown>) => ({
          id: e._id,
          service: e.service,
          eventType: e.eventType,
          exitCode: e.exitCode,
          timestamp: e.timestamp,
          logsPreview:
            typeof e.rawLogs === 'string' ? e.rawLogs.slice(0, 300) : '',
        })),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch incidents: ${message}`);
      return { status: 'error', message, incidents: [] };
    }
  }

  /**
   * Get a single incident by ID with full detail.
   */
  @Get('incidents/:id')
  async getIncident(@Param('id') id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid incident ID format.');
    }
    try {
      const event = await this.mongoService.EventModel.findById(id)
        .lean()
        .exec();
      if (!event) {
        throw new NotFoundException('Incident not found.');
      }

      // Find related plan
      const plan = await this.mongoService.PlanModel.findOne({ event: id })
        .lean()
        .exec();

      // Find related execution
      let execution = null;
      if (plan) {
        execution = await this.mongoService.ExecutionModel.findOne({
          plan: plan._id,
        })
          .lean()
          .exec();
      }

      // Find related embedding
      const embedding = await this.mongoService.EmbeddingModel.findOne({
        event: id,
      })
        .select({ vector: 0 })
        .lean()
        .exec();

      return {
        status: 'ok',
        incident: {
          id: event._id,
          service: event.service,
          eventType: event.eventType,
          exitCode: event.exitCode,
          timestamp: event.timestamp,
          rawLogs: event.rawLogs,
          metadata: event.metadata,
        },
        plan: plan
          ? {
              id: plan._id,
              analysis: plan.analysis,
              confidenceScore: plan.confidenceScore,
              suggestedAction: plan.suggestedAction,
              riskLevel: plan.riskLevel,
              reasoning: plan.reasoning,
              status: plan.status,
              processingTimeMs: plan.processingTimeMs,
            }
          : null,
        execution: execution
          ? {
              id: execution._id,
              actionTaken: execution.actionTaken,
              isSuccessful: execution.isSuccessful,
              executionLogs: execution.executionLogs,
              durationMs: execution.durationMs,
              errorMessage: execution.errorMessage,
            }
          : null,
        embedding: embedding
          ? {
              id: embedding._id,
              incidentType: embedding.incidentType,
            }
          : null,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch incident ${id}: ${message}`);
      return { status: 'error', message };
    }
  }

  /**
   * List all remediation plans with optional filtering.
   */
  @Get('remediations')
  async listRemediations(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    try {
      const query: Record<string, unknown> = {};
      if (status) query.status = status;

      const limitNum = Math.min(parseInt(limit ?? '50', 10) || 50, 100);
      const offsetNum = parseInt(offset ?? '0', 10) || 0;

      const plans = await this.mongoService.PlanModel.find(query)
        .sort({ createdAt: -1 })
        .skip(offsetNum)
        .limit(limitNum)
        .lean()
        .exec();

      const total =
        await this.mongoService.PlanModel.countDocuments(query).exec();

      return {
        status: 'ok',
        count: plans.length,
        total,
        remediations: plans.map((p: Record<string, unknown>) => ({
          id: p._id,
          event: p.event,
          incidentType: p.incidentType,
          suggestedAction: p.suggestedAction,
          confidenceScore: p.confidenceScore,
          riskLevel: p.riskLevel,
          status: p.status,
          reasoning: p.reasoning,
          processingTimeMs: p.processingTimeMs,
          createdAt: p.createdAt,
        })),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch remediations: ${message}`);
      return { status: 'error', message, remediations: [] };
    }
  }

  /**
   * Get a single remediation plan by ID.
   */
  @Get('remediations/:id')
  async getRemediation(@Param('id') id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid remediation ID format.');
    }
    try {
      const plan = await this.mongoService.PlanModel.findById(id).lean().exec();
      if (!plan) {
        throw new NotFoundException('Remediation plan not found.');
      }

      const execution = await this.mongoService.ExecutionModel.findOne({
        plan: id,
      })
        .lean()
        .exec();

      return {
        status: 'ok',
        remediation: {
          id: plan._id,
          event: plan.event,
          analysis: plan.analysis,
          confidenceScore: plan.confidenceScore,
          suggestedAction: plan.suggestedAction,
          riskLevel: plan.riskLevel,
          reasoning: plan.reasoning,
          status: plan.status,
          processingTimeMs: plan.processingTimeMs,
          createdAt: plan.createdAt,
        },
        execution: execution
          ? {
              id: execution._id,
              actionTaken: execution.actionTaken,
              isSuccessful: execution.isSuccessful,
              executionLogs: execution.executionLogs,
              durationMs: execution.durationMs,
              errorMessage: execution.errorMessage,
            }
          : null,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch remediation ${id}: ${message}`);
      return { status: 'error', message };
    }
  }

  /**
   * Get platform metrics: crash frequency, MTBF, remediation success rate.
   */
  @Get('metrics')
  async getMetrics() {
    try {
      const totalIncidents =
        await this.mongoService.EventModel.countDocuments().exec();
      const totalPlans =
        await this.mongoService.PlanModel.countDocuments().exec();
      const completedPlans = await this.mongoService.PlanModel.countDocuments({
        status: 'COMPLETED',
      }).exec();
      const failedPlans = await this.mongoService.PlanModel.countDocuments({
        status: 'FAILED',
      }).exec();
      const skippedPlans = await this.mongoService.PlanModel.countDocuments({
        status: 'SKIPPED',
      }).exec();
      const totalServices =
        await this.mongoService.ServiceModel.countDocuments().exec();

      // Crash frequency: incidents in last hour
      const oneHourAgo = new Date(Date.now() - 3_600_000);
      const recentIncidents = await this.mongoService.EventModel.countDocuments(
        {
          timestamp: { $gte: oneHourAgo },
        },
      ).exec();

      // MTBF: average time between crashes for each service
      const services = await this.mongoService.ServiceModel.find()
        .select({
          containerId: 1,
          name: 1,
          totalCrashCount: 1,
          restartCount: 1,
          status: 1,
          lastCrashAt: 1,
        })
        .lean()
        .exec();

      const remediationSuccessRate =
        totalPlans > 0 ? Math.round((completedPlans / totalPlans) * 100) : 0;

      return {
        status: 'ok',
        metrics: {
          totalIncidents,
          totalPlans,
          completedPlans,
          failedPlans,
          skippedPlans,
          remediationSuccessRate: `${remediationSuccessRate}%`,
          recentIncidents,
          totalServices,
          services: services.map((s: Record<string, unknown>) => ({
            name: s.name,
            status: s.status,
            totalCrashCount: s.totalCrashCount,
            restartCount: s.restartCount,
            lastCrashAt: s.lastCrashAt,
          })),
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch metrics: ${message}`);
      return { status: 'error', message };
    }
  }

  /**
   * List current runtime exclusions.
   */
  @Get('exclusions')
  getExclusions() {
    return {
      status: 'ok',
      hardcoded: [
        'aegis-mongodb',
        'aegis-kafka',
        'aegis-kafka-ui',
        'aegis-ai-engine',
        'aegis-control-plane',
      ],
      prefixRule: 'aegis-*',
      dynamic: Array.from(DYNAMIC_IGNORED_CONTAINERS),
    };
  }

  /**
   * Add a runtime exclusion (does not persist to .env).
   */
  @Post('exclusions')
  @UseGuards(InternalTokenGuard)
  @HttpCode(HttpStatus.CREATED)
  addExclusion(@Body('name') name: string) {
    if (!name) {
      return { status: 'error', message: 'Name is required' };
    }
    const normalized = name.trim().replace(/^\/+/, '');
    DYNAMIC_IGNORED_CONTAINERS.add(normalized);
    this.logger.log(`Added runtime exclusion: ${normalized}`);
    return {
      status: 'ok',
      message: `Added "${normalized}" to runtime exclusions`,
      exclusions: Array.from(DYNAMIC_IGNORED_CONTAINERS),
    };
  }

  /**
   * Remove a runtime exclusion.
   */
  @Delete('exclusions/:name')
  @UseGuards(InternalTokenGuard)
  removeExclusion(@Param('name') name: string) {
    const normalized = name.trim().replace(/^\/+/, '');
    const existed = DYNAMIC_IGNORED_CONTAINERS.delete(normalized);
    this.logger.log(
      `Removed runtime exclusion: ${normalized} (existed: ${existed})`,
    );
    return {
      status: 'ok',
      message: `Removed "${normalized}" from runtime exclusions`,
      exclusions: Array.from(DYNAMIC_IGNORED_CONTAINERS),
    };
  }
}
