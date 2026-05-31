import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service.js';
import { AuditService } from './audit.service.js';
import { RemediationEngine } from './remediation.service.js';
import { OrchestratorController } from './orchestrator.controller.js';
import { DockerModule } from '../docker/docker.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { GatewayModule } from '../gateway/gateway.module.js';
import { KafkaModule } from '../kafka/kafka.module.js';

@Module({
  imports: [DockerModule, QueueModule, AiAgentModule, GatewayModule, KafkaModule],
  controllers: [OrchestratorController],
  providers: [OrchestratorService, AuditService, RemediationEngine],
  exports: [OrchestratorService, AuditService, RemediationEngine],
})
export class OrchestratorModule {}
