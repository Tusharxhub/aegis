import { Module } from '@nestjs/common';
import { AiAgentService } from './ai-agent.service.js';
import { EmbeddingService } from './embedding.service.js';

@Module({
  providers: [AiAgentService, EmbeddingService],
  exports: [AiAgentService, EmbeddingService],
})
export class AiAgentModule {}
