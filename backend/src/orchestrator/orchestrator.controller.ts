import { Controller, Post, Get, InternalServerErrorException } from '@nestjs/common';
import { RlCoordinatorService } from './rl-coordinator.service.js';
import { MongoService } from '../mongo/mongo.service.js';

@Controller('orchestrator')
export class OrchestratorController {
  constructor(
    private readonly rlCoordinator: RlCoordinatorService,
    private readonly mongoService: MongoService,
  ) {}

  @Post('train')
  async triggerTraining(): Promise<any> {
    try {
      const result = await this.rlCoordinator.triggerManualTraining();
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`Failed to trigger training: ${message}`);
    }
  }

  @Get('episodes')
  async getRecentEpisodes(): Promise<any[]> {
    try {
      // Return the last 50 episodes for the frontend table representation
      return await this.mongoService.EpisodeModel.find()
        .sort({ timestamp: -1 })
        .limit(50)
        .exec();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`Failed to retrieve episodes: ${message}`);
    }
  }

  @Get('services')
  async getServices(): Promise<any[]> {
    try {
      return await this.mongoService.ServiceModel.find().exec();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`Failed to retrieve service states: ${message}`);
    }
  }
}
