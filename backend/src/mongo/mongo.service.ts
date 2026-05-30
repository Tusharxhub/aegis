import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mongoose, { Connection, Schema, Model } from 'mongoose';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  public connection!: Connection;

  // Models
  public ServiceModel!: Model<any>;
  public EventModel!: Model<any>;
  public PlanModel!: Model<any>;
  public ExecutionModel!: Model<any>;
  public EpisodeModel!: Model<any>;

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
    // 1. Service Schema
    const serviceSchema = new Schema({
      name: { type: String, required: true },
      imageName: { type: String, required: true },
      containerId: { type: String, required: true, unique: true },
      status: {
        type: String,
        enum: ['HEALTHY', 'DEGRADED', 'CRASHED', 'RESTARTING', 'UNKNOWN'],
        default: 'HEALTHY',
      },
      exitCode: { type: Number, default: null },
      restartCount: { type: Number, default: 0 },
      lastSeenAt: { type: Date, default: Date.now },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    });
    this.ServiceModel = this.connection.model('Service', serviceSchema);

    // 2. InfrastructureEvent Schema
    const eventSchema = new Schema({
      serviceId: { type: String, required: true },
      eventType: { type: String, enum: ['DIE', 'OOM', 'KILL', 'HEALTH_CHECK_FAIL'], required: true },
      exitCode: { type: Number, default: null },
      rawLogs: { type: String, required: true },
      metadata: { type: Schema.Types.Mixed, default: {} },
      timestamp: { type: Date, default: Date.now },
    });
    this.EventModel = this.connection.model('InfrastructureEvent', eventSchema);

    // 3. RemediationPlan Schema
    const planSchema = new Schema({
      eventId: { type: String, required: true, unique: true },
      aiAnalysis: { type: String, required: true },
      confidenceScore: { type: Number, required: true },
      suggestedAction: {
        type: String,
        enum: ['RESTART', 'SCALE', 'ROLLBACK', 'ALERT_ONLY', 'RESOURCE_LIMIT_ADJUST'],
        required: true,
      },
      actionCommand: { type: String, required: true },
      actionParams: { type: Schema.Types.Mixed, default: {} },
      status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'SKIPPED'],
        default: 'PENDING',
      },
      processingTimeMs: { type: Number, default: null },
      createdAt: { type: Date, default: Date.now },
    });
    this.PlanModel = this.connection.model('RemediationPlan', planSchema);

    // 4. ActionExecution Schema
    const executionSchema = new Schema({
      planId: { type: String, required: true, unique: true },
      actionTaken: { type: String, required: true },
      isSuccessful: { type: Boolean, required: true },
      executionLogs: { type: String, default: '' },
      durationMs: { type: Number, default: null },
      errorMessage: { type: String, default: null },
      executedAt: { type: Date, default: Date.now },
    });
    this.ExecutionModel = this.connection.model('ActionExecution', executionSchema);

    // 5. RL Replay Episode Schema
    const episodeSchema = new Schema({
      state_vector: { type: [Number], required: true },
      action_taken: { type: Number, required: true },
      reward: { type: Number, required: true },
      next_state_vector: { type: [Number], required: true },
      timestamp: { type: Date, default: Date.now },
      containerName: { type: String, required: true },
      imageName: { type: String, required: true },
      exitCode: { type: Number, required: true },
      eventType: { type: String, required: true },
    });
    this.EpisodeModel = this.connection.model('Episode', episodeSchema);
    
    this.logger.log('✅ Native Mongoose schemas compiled and models initialized.');
  }
}
