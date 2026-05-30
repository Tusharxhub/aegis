import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module.js';

/**
 * Bootstrap the Aegis NestJS server.
 *
 * - Enables CORS for the Next.js frontend.
 * - Configures Socket.io adapter for WebSocket support.
 * - Binds to the configured port (default: 4000).
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // CORS for Next.js frontend
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      process.env.FRONTEND_URL ?? 'http://localhost:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  });

  // Socket.io adapter
  app.useWebSocketAdapter(new IoAdapter(app));

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
║   WebSocket:      ws://localhost:${port}/aegis                 ║
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
