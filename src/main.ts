import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

/**
 * Bootstrap — Aegis Control Plane
 *
 * Headless backend-only service. Kafka-native event backbone.
 * Graceful shutdown: captures SIGTERM/SIGINT to allow Kafka consumers
 * and MongoDB connections to disconnect cleanly before process exit.
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

  // Graceful shutdown — allows Kafka consumers and Mongo to disconnect cleanly
  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT ?? '4000', 10);
  await app.listen(port, '0.0.0.0');

  const banner = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║                                                              ║',
    '║   🛡️  PROJECT AEGIS — Kafka-Native AIOps Control Plane       ║',
    '║                                                              ║',
    `║   Control Plane:  http://0.0.0.0:${port}                      ║`,
    `║   Environment:    ${(process.env.NODE_ENV ?? 'development').padEnd(30)}║`,
    '║   Mode:           headless backend (no frontend)             ║',
    '║                                                              ║',
    '╚══════════════════════════════════════════════════════════════╝',
  ].join('\n');

  logger.log(`\n${banner}`);
  logger.log('[AEGIS] Control plane online');
}

bootstrap().catch((err: unknown) => {
  const logger = new Logger('Bootstrap');
  const message = err instanceof Error ? err.message : 'Unknown startup error';
  logger.error(`❌ Failed to start Aegis Control Plane: ${message}`);
  process.exit(1);
});
