import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { KafkaHealthService } from './kafka/kafka.health.js';

/**
 * Bootstrap — Aegis Control Plane
 *
 * Headless backend-only service. Kafka-native event backbone.
 * Graceful shutdown: captures SIGTERM/SIGINT to allow Kafka consumers,
 * outbox workers, and MongoDB connections to disconnect cleanly before process exit.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  process.env.KAFKAJS_NO_PARTITIONER_WARNING =
    process.env.KAFKAJS_NO_PARTITIONER_WARNING ?? '1';

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
    abortOnError: false,
  });

  // Security hardening
  app.use(helmet());

  // Internal API prefix — not a public-facing API surface
  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  // Swagger / OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('Project Aegis API')
    .setDescription('Kafka-native AIOps self-healing infrastructure platform')
    .setVersion('1.0')
    .addTag('containers', 'Container monitoring and management')
    .addTag('incidents', 'Crash incident tracking')
    .addTag('remediations', 'Remediation plan management')
    .addTag('health', 'Platform health checks')
    .addTag('metrics', 'Platform metrics and analytics')
    .addTag('exclusions', 'Container exclusion management')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Graceful shutdown — allows Kafka consumers, outbox, and Mongo to disconnect cleanly
  app.enableShutdownHooks();

  // Log shutdown signals before they propagate to NestJS lifecycle hooks
  const shutdownLogger = new Logger('Shutdown');
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, () => {
      shutdownLogger.log(`[AEGIS] Received ${signal} — shutdown initiated`);
    });
  }

  const port = parseInt(
    process.env.BACKEND_PORT ?? process.env.PORT ?? '3001',
    10,
  );
  await app.listen(port, '0.0.0.0');

  const banner = [
    '╔════════════════════════════════════════════════════════════════════════╗',
    '║                                                                        ║',
    '║     PROJECT AEGIS — Kafka-Native AIOps Control Plane                   ║',
    '║                                                                        ║',
    `║   Control Plane:  http://0.0.0.0:${port}                               ║`,
    `║   Swagger Docs:   http://0.0.0.0:${port}/api/docs                     ║`,
    `║   Environment:    ${(process.env.NODE_ENV ?? 'development').padEnd(30)}║`,
    '║   Mode:           headless backend (no frontend)                       ║',
    '║                                                                        ║',
    '╚════════════════════════════════════════════════════════════════════════╝',
  ].join('\n');

  logger.log(`\n${banner}`);

  const kafkaHealth = app.get(KafkaHealthService);
  const snapshot = kafkaHealth.getSnapshot();
  if (!snapshot.producerConnected) {
    logger.warn(
      '[AEGIS] Control plane online in DEGRADED mode: Kafka unavailable',
    );
  } else {
    logger.log('[AEGIS] Control plane online');
  }
}

bootstrap().catch((err: unknown) => {
  const logger = new Logger('Bootstrap');
  const message = err instanceof Error ? err.message : 'Unknown startup error';
  logger.error(`❌ Failed to start Aegis Control Plane: ${message}`);
  process.exit(1);
});
