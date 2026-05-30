import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const mongoUri =
      this.configService.get<string>('MONGO_URI') ??
      'mongodb://aegis-mongo:27017/aegis';

    this.logger.log(`🔌 Initializing Mongoose Connection to local MongoDB: ${mongoUri}`);

    try {
      this.connection = await mongoose.createConnection(mongoUri).asPromise();
      this.logger.log('✅ MongoDB connection established successfully.');
      this.initializeSchemasAndModels();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`❌ Failed to connect to MongoDB: ${message}`);
      throw err;
    }
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
    this.EventModel = this.connection.model('InfrastructureEvent', InfrastructureEventSchema);
    this.EmbeddingModel = this.connection.model('IncidentEmbedding', IncidentEmbeddingSchema);
    this.PlanModel = this.connection.model('RemediationPlan', RemediationPlanSchema);
    this.ExecutionModel = this.connection.model('ActionExecution', ActionExecutionSchema);
    this.EpisodeModel = this.connection.model('Episode', EpisodeSchema);
    this.MetricsModel = this.connection.model('MetricsSnapshot', MetricsSnapshotSchema);
    
    this.logger.log('✅ Mongoose schemas compiled and models initialized.');
  }
}
