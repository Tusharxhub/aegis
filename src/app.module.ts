import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongoModule } from './mongo/mongo.module.js';
import { DockerModule } from './docker/docker.module.js';
import { AiAgentModule } from './ai-agent/ai-agent.module.js';
import { OrchestratorModule } from './orchestrator/orchestrator.module.js';
import { KafkaModule } from './kafka/kafka.module.js';
import { HealthModule } from './health/health.module.js';
import { validateEnvironmentVariables } from './common/config/environment.js';

/**
 * AppModule — Root module for Project Aegis.
 *
 * Kafka-native, headless AIOps control plane.
 */
@Module({
  imports: [
    // Global environment configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnvironmentVariables,
    }),

    // Internal decoupled event bus
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

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
