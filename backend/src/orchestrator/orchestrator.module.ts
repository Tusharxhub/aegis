import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service.js';
import { RlCoordinatorService } from './rl-coordinator.service.js';
import { OrchestratorController } from './orchestrator.controller.js';
import { DockerModule } from '../docker/docker.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { GatewayModule } from '../gateway/gateway.module.js';

@Module({
  imports: [DockerModule, QueueModule, AiAgentModule, GatewayModule],
  controllers: [OrchestratorController],
  providers: [OrchestratorService, RlCoordinatorService],
  exports: [OrchestratorService, RlCoordinatorService],
})
export class OrchestratorModule {}
