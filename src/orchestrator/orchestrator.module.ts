import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service.js';
import { OrchestratorController } from './orchestrator.controller.js';
import { AuditService } from './audit.service.js';
import { DockerModule } from '../docker/docker.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';

@Module({
  imports: [DockerModule, AiAgentModule],
  providers: [OrchestratorService, AuditService],
  controllers: [OrchestratorController],
  exports: [OrchestratorService, AuditService],
})
export class OrchestratorModule {}
