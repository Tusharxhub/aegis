import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OrchestratorService } from './orchestrator.service.js';
import { OrchestratorController } from './orchestrator.controller.js';
import { AuditService } from './audit.service.js';
import { OutboxService } from './outbox.service.js';
import { HealthReconciler } from './health-reconciler.service.js';
import { DockerModule } from '../docker/docker.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';

@Module({
  imports: [DockerModule, AiAgentModule, ScheduleModule.forRoot()],
  providers: [
    OrchestratorService,
    AuditService,
    OutboxService,
    HealthReconciler,
  ],
  controllers: [OrchestratorController],
  exports: [OrchestratorService, AuditService, OutboxService],
})
export class OrchestratorModule {}
