import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongoModule } from './mongo/mongo.module.js';
import { DockerModule } from './docker/docker.module.js';
import { QueueModule } from './queue/queue.module.js';
import { AiAgentModule } from './ai-agent/ai-agent.module.js';
import { OrchestratorModule } from './orchestrator/orchestrator.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { KafkaModule } from './kafka/kafka.module.js';

/**
 * AppModule — Root module for Project Aegis.
 * Coordinates configuration, event emitters, database client (MongoDB),
 * and individual domain services.
 */
@Module({
  imports: [
    // Global environment configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),

    // Internal decoupled event bus
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

    // Relational/Document Database Layer (MongoDB)
    MongoModule,
    KafkaModule,

    // Core Domain modules
    DockerModule,
    QueueModule,
    AiAgentModule,
    GatewayModule,
    OrchestratorModule,
  ],
})
export class AppModule {}
