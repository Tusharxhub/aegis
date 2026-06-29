import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DockerService } from '../docker/docker.service.js';
import { AuditService } from './audit.service.js';
import { ServiceStatus } from '../common/interfaces/db-types.js';
import { MongoService } from '../mongo/mongo.service.js';

/**
 * HealthReconciler — Periodically checks container status and reconciles
 * the service state in MongoDB.
 *
 * Transitions:
 *   RESTARTING -> HEALTHY   (container is running and healthy)
 *   RESTARTING -> DEGRADED  (container is running but unhealthy)
 *   RESTARTING -> CRASHED   (container has died again)
 */
@Injectable()
export class HealthReconciler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthReconciler.name);
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly dockerService: DockerService,
    private readonly auditService: AuditService,
    private readonly mongoService: MongoService,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      'Health reconciler initialized — will poll container status every 30s.',
    );
    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, 30_000);
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  async reconcile(): Promise<void> {
    try {
      // Get all services in RESTARTING state
      const restartingServices = await this.mongoService.ServiceModel.find({
        status: ServiceStatus.RESTARTING,
      })
        .lean()
        .exec();

      if (restartingServices.length === 0) return;

      this.logger.debug(
        `Reconciling ${restartingServices.length} RESTARTING service(s)...`,
      );

      for (const service of restartingServices) {
        try {
          const containerInfo = await this.dockerService.inspectContainer(
            service.containerId,
          );
          const state = containerInfo.State;

          if (!state) {
            await this.auditService.updateServiceStatus(
              service.containerId,
              ServiceStatus.UNKNOWN,
            );
            continue;
          }

          if (state.Running && !state.OOMKilled && state.ExitCode === 0) {
            // Container is running fine
            const healthStatus = state.Health?.Status;
            if (healthStatus === 'healthy' || !healthStatus) {
              this.logger.log(`Service "${service.name}" is now HEALTHY.`);
              await this.auditService.updateServiceStatus(
                service.containerId,
                ServiceStatus.HEALTHY,
              );
            } else if (healthStatus === 'unhealthy') {
              this.logger.warn(`Service "${service.name}" is unhealthy.`);
              await this.auditService.updateServiceStatus(
                service.containerId,
                ServiceStatus.DEGRADED,
              );
            } else {
              // starting or none — keep as is
            }
          } else if (state.OOMKilled || state.ExitCode !== 0) {
            // Container died again after restart
            this.logger.warn(
              `Service "${service.name}" crashed again (exit: ${state.ExitCode}, OOM: ${state.OOMKilled}).`,
            );
            await this.auditService.updateServiceStatus(
              service.containerId,
              ServiceStatus.CRASHED,
            );
          } else if (!state.Running) {
            // Container stopped
            this.logger.warn(`Service "${service.name}" is not running.`);
            await this.auditService.updateServiceStatus(
              service.containerId,
              ServiceStatus.DEGRADED,
            );
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to inspect container ${service.containerId}: ${message}`,
          );
          // Container might not exist anymore — mark as unknown
          await this.auditService.updateServiceStatus(
            service.containerId,
            ServiceStatus.UNKNOWN,
          );
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Health reconciliation error: ${message}`);
    }
  }
}
