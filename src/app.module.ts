import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { MongoModule } from './mongo/mongo.module.js';
import { DockerModule } from './docker/docker.module.js';
import { AiAgentModule } from './ai-agent/ai-agent.module.js';
import { OrchestratorModule } from './orchestrator/orchestrator.module.js';
import { KafkaModule } from './kafka/kafka.module.js';
import { HealthModule } from './health/health.module.js';

/**
 * AppModule — Root module for Project Aegis.
 *
 * Kafka-native, headless AIOps control plane.
 * No WebSocket, no Redis, no BullMQ, no frontend.
 */
@Module({
  imports: [
    // Global environment configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Internal decoupled event bus
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

    // Rate limiting for security
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    // Core infrastructure
    MongoModule,
    KafkaModule,

    // Domain modules
    DockerModule,
    AiAgentModule,
    OrchestratorModule,
    HealthModule,
  ],
})
export class AppModule {}
