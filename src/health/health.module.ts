import { Module } from '@nestjs/common';
import { AiAgentModule } from '../ai-agent/ai-agent.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [AiAgentModule],
  controllers: [HealthController],
})
export class HealthModule {}
