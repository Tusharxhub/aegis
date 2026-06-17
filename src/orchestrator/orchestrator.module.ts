import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service.js';
import { OrchestratorController } from './orchestrator.controller.js';
import { AuditService } from './audit.service.js';
import { OutboxService } from './outbox.service.js';
import { DockerModule } from '../docker/docker.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';

@Module({
  imports: [DockerModule, AiAgentModule],
  providers: [OrchestratorService, AuditService, OutboxService],
  controllers: [OrchestratorController],
  exports: [OrchestratorService, AuditService, OutboxService],
})
export class OrchestratorModule {}

