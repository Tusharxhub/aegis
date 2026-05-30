import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as Docker from 'dockerode';

@Injectable()
export class DockerService implements OnModuleInit {
  private docker: Docker;
  private readonly logger = new Logger(DockerService.name);

  constructor() {
    // Connects to the local host's Docker socket
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  // This runs automatically when the NestJS server starts
  async onModuleInit() {
    this.logger.log('🛡️ Aegis Watcher initializing... connecting to Docker socket.');
    await this.listenToContainerCrashes();
  }

  private async listenToContainerCrashes() {
    try {
      const stream = await this.docker.getEvents({
        filters: { type: ['container'], event: ['die', 'oom'] },
      });

      this.logger.log('📡 Aegis is now actively monitoring infrastructure events.');

      stream.on('data', async (chunk) => {
        const event = JSON.parse(chunk.toString('utf8'));
        
        // Ignore the Ollama AI container and the Postgres/Redis containers if they exist
        if (event.Actor.Attributes.name.includes('aegis-ollama')) return;

        this.logger.warn(`🚨 CRITICAL: Container [${event.Actor.Attributes.name}] crashed!`);
        
        // Fetch the raw error logs from the dead container
        const logs = await this.getContainerLogs(event.Actor.ID);
        this.logger.error(`Extracted ${logs.length} characters of crash logs.`);

        // TODO in Phase 4: Send these logs to BullMQ for the AI to analyze
      });

    } catch (error) {
      this.logger.error('Failed to connect to Docker socket. Is Docker running?', error);
    }
  }

  // Helper function to pull the actual error text
  private async getContainerLogs(containerId: string): Promise<string> {
    const container = this.docker.getContainer(containerId);
    try {
      const logBuffer = await container.logs({
        stdout: true,
        stderr: true,
        tail: 100, // We only need the last 100 lines to know why it crashed
      });
      // Clean up the Docker multiplexed stream format into raw text
      return logBuffer.toString('utf8').replace(/[\u0000-\u001F]/g, ''); 
    } catch (error) {
      return `Failed to extract logs: ${error.message}`;
    }
  }
}