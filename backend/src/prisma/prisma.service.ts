import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma service wrapping the PrismaClient lifecycle.
 * Connects on module init, disconnects on destroy.
 * Exposes the full PrismaClient for type-safe DB access.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('🔌 Connecting to Neon DB (Serverless Postgres)...');

    try {
      await this.$connect();
      this.logger.log('✅ Database connection established.');
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown database error';
      this.logger.error(`❌ Failed to connect to database: ${message}`);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('🔌 Disconnecting from database...');
    await this.$disconnect();
  }

  /**
   * Health check — attempts a trivial query to verify connectivity.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
