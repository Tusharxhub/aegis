import { Module } from '@nestjs/common';
import { DockerService } from './docker.service.js';

@Module({
  providers: [DockerService],
  exports: [DockerService],
})
export class DockerModule {}
