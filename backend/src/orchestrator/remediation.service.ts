import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docker from 'dockerode';

@Injectable()
export class RemediationEngine {
  private readonly logger = new Logger(RemediationEngine.name);
  private docker: Docker;

  constructor(private readonly configService: ConfigService) {
    const socketPath =
      this.configService.get<string>('DOCKER_SOCKET_PATH') ??
      '/var/run/docker.sock';
    this.docker = new Docker({ socketPath });
  }

  /**
   * Safe Restart Action Execution.
   */
  async executeRestart(containerId: string): Promise<string> {
    this.logger.log(`Executing container restart task on: ${containerId}`);
    try {
      const container = this.docker.getContainer(containerId);
      await container.restart({ t: 10 });
      return `Restart signal sent. Container ${containerId.slice(0, 12)} restarted successfully.`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Restart command failed: ${message}`);
      throw new Error(`Docker restart error: ${message}`);
    }
  }

  /**
   * Safe Stop Action Execution.
   */
  async executeStop(containerId: string): Promise<string> {
    this.logger.log(`Executing container stop task on: ${containerId}`);
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 10 });
      return `Stop signal sent. Container ${containerId.slice(0, 12)} halted to prevent loop failure.`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // If container is already stopped, count it as a success
      if (message.includes('container already stopped')) {
        return `Container ${containerId.slice(0, 12)} is already in stopped state.`;
      }
      this.logger.error(`Stop command failed: ${message}`);
      throw new Error(`Docker stop error: ${message}`);
    }
  }
}
