import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

/**
 * Bootstrap the Aegis NestJS server.
 *
 * - Starts the headless control plane API.
 * - Binds to the configured port (default: 4000).
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // API prefix
  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  const port = parseInt(process.env.BACKEND_PORT ?? '4000', 10);
  await app.listen(port);

  logger.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🛡️  PROJECT AEGIS — AI Infrastructure Guardian             ║
║                                                              ║
║   HTTP Server:    http://localhost:${port}                     ║
║   Environment:    ${process.env.NODE_ENV ?? 'development'}                          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
}

bootstrap().catch((err: unknown) => {
  const logger = new Logger('Bootstrap');
  const message = err instanceof Error ? err.message : 'Unknown startup error';
  logger.error(`❌ Failed to start Aegis: ${message}`);
  process.exit(1);
});
