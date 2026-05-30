import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

function createPrismaAdapter(): PrismaPg {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  return new PrismaPg({ connectionString });
}

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
      adapter: createPrismaAdapter(),
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
