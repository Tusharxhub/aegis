import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import mongoose, { Connection, Model } from 'mongoose';
import {
  ServiceSchema,
  InfrastructureEventSchema,
  IncidentEmbeddingSchema,
  RemediationPlanSchema,
  ActionExecutionSchema,
  EpisodeSchema,
  MetricsSnapshotSchema,
} from './schemas/index.js';

/**
 * Maximum number of connection attempts before giving up.
 * Each retry waits `RETRY_DELAY_MS` before the next attempt.
 */
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3_000;

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  public connection!: Connection;

  // Models
  public ServiceModel!: Model<any>;
  public EventModel!: Model<any>;
  public EmbeddingModel!: Model<any>;
  public PlanModel!: Model<any>;
  public ExecutionModel!: Model<any>;
  public EpisodeModel!: Model<any>;
  public MetricsModel!: Model<any>;

  async onModuleInit(): Promise<void> {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      throw new Error(
        'MONGODB_URI is not set. Ensure your .env file contains MONGODB_URI=mongodb://localhost:27017/aegis',
      );
    }

    this.logger.log(`Connecting to MongoDB at: ${mongoUri}`);
    await this.connectWithRetry(mongoUri);
    this.initializeSchemasAndModels();
  }

  private async connectWithRetry(uri: string): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.log(
          `Attempt ${attempt}/${MAX_RETRIES} — connecting to MongoDB...`,
        );

        this.connection = await mongoose
          .createConnection(uri, {
            serverSelectionTimeoutMS: 5_000,
            connectTimeoutMS: 10_000,
            socketTimeoutMS: 45_000,
          })
          .asPromise();

        this.logger.log('MongoDB connection established successfully.');
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        if (attempt === MAX_RETRIES) {
          this.logger.error(
            `MongoDB connection failed after ${MAX_RETRIES} attempts: ${message}`,
          );
          throw new Error(
            `MongoDB connection failed after ${MAX_RETRIES} attempts: ${message}`,
          );
        }

        this.logger.warn(
          `Attempt ${attempt}/${MAX_RETRIES} failed — ${message}. Retrying in ${RETRY_DELAY_MS / 1_000}s...`,
        );

        await this.sleep(RETRY_DELAY_MS);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connection) {
      this.logger.log('🔌 Disconnecting Mongoose from MongoDB...');
      await this.connection.close();
      this.logger.log('✅ MongoDB disconnected.');
    }
  }

  private initializeSchemasAndModels(): void {
    this.ServiceModel = this.connection.model('Service', ServiceSchema);
    this.EventModel = this.connection.model(
      'InfrastructureEvent',
      InfrastructureEventSchema,
    );
    this.EmbeddingModel = this.connection.model(
      'IncidentEmbedding',
      IncidentEmbeddingSchema,
    );
    this.PlanModel = this.connection.model(
      'RemediationPlan',
      RemediationPlanSchema,
    );
    this.ExecutionModel = this.connection.model(
      'ActionExecution',
      ActionExecutionSchema,
    );
    this.EpisodeModel = this.connection.model('Episode', EpisodeSchema);
    this.MetricsModel = this.connection.model(
      'MetricsSnapshot',
      MetricsSnapshotSchema,
    );

    this.logger.log('✅ Mongoose schemas compiled and models initialized.');
  }
}
