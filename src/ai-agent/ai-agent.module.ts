import { Module } from '@nestjs/common';
import { AiAgentService } from './ai-agent.service.js';

@Module({
  providers: [AiAgentService],
  exports: [AiAgentService],
})
export class AiAgentModule {}
