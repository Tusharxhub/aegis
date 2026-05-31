import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

/**
 * Bootstrap — Aegis Control Plane
 *
 * Headless backend-only service. No CORS, no global validation pipes
 * for frontend consumption. Deterministic startup sequence.
 *
 * Graceful shutdown: captures SIGTERM and SIGINT to allow Kafka consumers
 * and MongoDB connections to disconnect cleanly before process exit.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
    // Disable the default NestJS HTTP exception filter noise in production
    abortOnError: false,
  });

  // Internal API prefix — not a public-facing API surface
  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  // Graceful shutdown — allows Kafka consumers and Mongo to disconnect cleanly
  app.enableShutdownHooks();

  const port = parseInt(process.env.BACKEND_PORT ?? '4000', 10);
  await app.listen(port, '0.0.0.0');

  logger.log(
    `\n╔══════════════════════════════════════════════════════════════╗\n` +
    `║                                                              ║\n` +
    `║   🛡️  PROJECT AEGIS — Kafka-Native AIOps Control Plane       ║\n` +
    `║                                                              ║\n` +
    `║   Control Plane:  http://0.0.0.0:${port}                      ║\n` +
    `║   Environment:    ${(process.env.NODE_ENV ?? 'development').padEnd(30)}║\n` +
    `║   Mode:           headless backend (no frontend)             ║\n` +
    `║                                                              ║\n` +
    `╚══════════════════════════════════════════════════════════════╝`,
  );
}

bootstrap().catch((err: unknown) => {
  const logger = new Logger('Bootstrap');
  const message = err instanceof Error ? err.message : 'Unknown startup error';
  logger.error(`❌ Failed to start Aegis Control Plane: ${message}`);
  process.exit(1);
});
