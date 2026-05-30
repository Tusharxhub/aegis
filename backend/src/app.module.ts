import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module.js';
import { DockerModule } from './docker/docker.module.js';
import { QueueModule } from './queue/queue.module.js';
import { AiAgentModule } from './ai-agent/ai-agent.module.js';
import { OrchestratorModule } from './orchestrator/orchestrator.module.js';
import { GatewayModule } from './gateway/gateway.module.js';

/**
 * AppModule — Root module for Project Aegis.
 *
 * Wiring order:
 *   ConfigModule (env) → PrismaModule (DB) → DockerModule (watcher)
 *   → QueueModule (BullMQ) → AiAgentModule (Ollama) → GatewayModule (WS)
 *   → OrchestratorModule (coordinator)
 *
 * EventEmitterModule provides the internal event bus that decouples
 * Docker events from queue processing.
 */
@Module({
  imports: [
    // Global configuration from .env
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),

    // Internal event bus
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

    // Data layer
    PrismaModule,

    // Infrastructure modules
    DockerModule,
    QueueModule,
    AiAgentModule,
    GatewayModule,

    // Central coordinator
    OrchestratorModule,
  ],
})
export class AppModule {}
