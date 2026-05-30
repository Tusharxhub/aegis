import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docker from 'dockerode';
import { MongoService } from '../mongo/mongo.service.js';
import { EmbeddingService } from '../ai-agent/embedding.service.js';
import { AegisGateway } from '../gateway/events.gateway.js';
import { WsEventName } from '../common/interfaces/websocket-event.interface.js';
import type { DockerCrashEvent } from '../common/interfaces/docker-event.interface.js';
import { randomUUID } from 'crypto';

@Injectable()
export class RlCoordinatorService implements OnModuleInit {
  private readonly logger = new Logger(RlCoordinatorService.name);
  private docker: Docker;
  private readonly rlBrainUrl: string;
  private readonly authToken: string;
  private readonly evaluationDelaySeconds: number;

  constructor(
    private readonly mongoService: MongoService,
    private readonly embeddingService: EmbeddingService,
    private readonly gateway: AegisGateway,
    private readonly configService: ConfigService,
  ) {
    const socketPath =
      this.configService.get<string>('DOCKER_SOCKET_PATH') ??
      '/var/run/docker.sock';
    this.docker = new Docker({ socketPath });

    this.rlBrainUrl =
      this.configService.get<string>('RL_BRAIN_URL') ??
      'http://aegis-rl-brain:8000';

    this.authToken =
      this.configService.get<string>('AEGIS_INTERNAL_KEY') ??
      'your_secure_dev_key';

    // 5 minutes in production, default 10 seconds for instant demo verification
    this.evaluationDelaySeconds = parseInt(
      this.configService.get<string>('EVALUATION_WINDOW_SECONDS') ?? '10',
      10,
    );
  }

  onModuleInit(): void {
    this.logger.log(
      `🤖 RL Coordinator Service online. Evaluation Window: ${this.evaluationDelaySeconds}s. Brain Endpoint: ${this.rlBrainUrl}`,
    );
  }

  /**
   * Orchestrate the full Markov Decision Process (MDP) loop.
   */
  async processCrashLoop(
    event: DockerCrashEvent,
    serviceId: string,
    eventId: string,
  ): Promise<void> {
    const startTime = Date.now();
    this.emitTerminalLog(
      'info',
      'RL Coordinator',
      `🚀 Starting RL Healing loop for container [${event.containerName}]`,
    );

    try {
      // 1. Get Log Embeddings from local Ollama
      this.emitTerminalLog(
        'ai',
        'Ollama',
        `📊 Generating embeddings for container logs...`,
      );
      const embedding = await this.embeddingService.getEmbedding(event.logs);
      this.logger.log(
        `Log embedding vector generated. Size: ${embedding.length}`,
      );

      // 2. Concatenate embeddings + exit code + OOM flag to form the State Vector
      const isOom = event.eventType === 'oom' ? 1.0 : 0.0;
      const normalizedExitCode = event.exitCode ? event.exitCode / 255.0 : 0.0;
      const stateVector = [...embedding, isOom, normalizedExitCode];

      this.gateway.broadcast(WsEventName.AI_ANALYSIS_START, {
        eventId,
        containerName: event.containerName,
        stateVector,
        timestamp: new Date().toISOString(),
      });

      // 3. Ask Python brain for predicted healing action
      this.emitTerminalLog(
        'ai',
        'RL Brain',
        `🧠 Requesting action inference from Python SB3 model...`,
      );
      const action = await this.requestActionPrediction(stateVector);
      this.emitTerminalLog(
        'ai',
        'RL Brain',
        `🎯 Decoded RL Action: ${action} [${this.getActionName(action)}]`,
      );

      // 4. Update the RemediationPlan database entry (MongoDB)
      const actionNamesMap = ['DO_NOTHING', 'RESTART', 'ROLLBACK', 'SCALE'];
      const planId = randomUUID();
      await this.mongoService.PlanModel.create({
        _id: planId,
        eventId,
        aiAnalysis: `RL Policy predicted action [${actionNamesMap[action]}] based on state vector.`,
        confidenceScore: 1.0,
        suggestedAction: actionNamesMap[action],
        actionCommand: `docker execute ${actionNamesMap[action]}`,
        actionParams: { action, containerName: event.containerName },
        status: 'EXECUTING',
        processingTimeMs: Date.now() - startTime,
      });

      this.gateway.broadcast(WsEventName.AI_ANALYSIS_COMPLETE, {
        eventId,
        planId,
        result: {
          analysis: `RL predicted action: ${actionNamesMap[action]}`,
          confidenceScore: 1.0,
          suggestedAction: {
            type: actionNamesMap[action].toLowerCase(),
            command: `execute ${action}`,
          },
        },
        processingTimeMs: Date.now() - startTime,
      });

      // 5. Execute corresponding Docker action
      const executionId = randomUUID();
      this.gateway.broadcast(WsEventName.REMEDIATION_EXECUTING, {
        eventId,
        planId,
        executionId,
        action: actionNamesMap[action].toLowerCase(),
        timestamp: new Date().toISOString(),
      });

      let executionLogs = '';
      let isSuccessful = true;

      try {
        executionLogs = await this.executeDockerAction(
          action,
          event.containerId,
          event.containerName,
        );
        this.emitTerminalLog(
          'info',
          'Docker API',
          `✅ Action executed: ${executionLogs}`,
        );
      } catch (err: unknown) {
        isSuccessful = false;
        executionLogs = err instanceof Error ? err.message : String(err);
        this.emitTerminalLog(
          'error',
          'Docker API',
          `❌ Failed to execute action: ${executionLogs}`,
        );
      }

      // Record Execution in DB
      await this.mongoService.ExecutionModel.create({
        _id: executionId,
        planId,
        actionTaken: actionNamesMap[action],
        isSuccessful,
        executionLogs,
        durationMs: Date.now() - startTime,
      });

      await this.mongoService.PlanModel.updateOne(
        { _id: planId },
        { status: isSuccessful ? 'COMPLETED' : 'FAILED' },
      );

      this.gateway.broadcast(WsEventName.REMEDIATION_COMPLETE, {
        eventId,
        planId,
        executionId,
        action: actionNamesMap[action].toLowerCase(),
        success: isSuccessful,
        logs: executionLogs,
        timestamp: new Date().toISOString(),
      });

      // Update service status in DB
      await this.mongoService.ServiceModel.updateOne(
        { containerId: event.containerId },
        {
          status: isSuccessful ? 'RESTARTING' : 'DEGRADED',
          restartCount: action === 1 ? { $inc: 1 } : undefined,
        },
      );

      // 6. Wait for evaluation window, evaluate reward, and commit Episode
      this.emitTerminalLog(
        'info',
        'RL Coordinator',
        `⏳ Scheduling Reward Evaluation in ${this.evaluationDelaySeconds}s...`,
      );
      setTimeout(() => {
        void this.evaluateRewardAndSaveEpisode({
          event,
          serviceId,
          eventId,
          stateVector,
          action,
          containerId: event.containerId,
          containerName: event.containerName,
        });
      }, this.evaluationDelaySeconds * 1000);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in RL Process Loop: ${msg}`);
      this.emitTerminalLog('error', 'RL Coordinator', `❌ Loop error: ${msg}`);
    }
  }

  /**
   * Hit the Python FastAPI API key-secured prediction route.
   */
  private async requestActionPrediction(
    stateVector: number[],
  ): Promise<number> {
    const url = `${this.rlBrainUrl}/predict`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Aegis-Auth-Token': this.authToken,
        },
        body: JSON.stringify({ state_vector: stateVector }),
      });

      if (!response.ok) {
        throw new Error(`Inference brain returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as { action: number };
      return data.action;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `RL Brain prediction failed: ${msg}. Falling back to default RESTART (1).`,
      );
      this.emitTerminalLog(
        'warn',
        'RL Brain',
        `⚠️ Prediction failed: ${msg}. Fallback: RESTART.`,
      );
      return 1; // Fallback to restart action
    }
  }

  /**
   * Execute the selected self-healing task using the Dockerode API.
   */
  private async executeDockerAction(
    action: number,
    containerId: string,
    containerName: string,
  ): Promise<string> {
    switch (action) {
      case 0:
        return 'Policy decided DO_NOTHING. Monitored without changes.';

      case 1: {
        const container = this.docker.getContainer(containerId);
        await container.restart({ t: 10 });
        return `Container ${containerName} restarted successfully.`;
      }

      case 2: {
        // Rollback simulation: stop, find previous version and restart
        const container = this.docker.getContainer(containerId);
        const inspect = await container.inspect();
        const currentImage = inspect.Config.Image;
        let rollbackImage = currentImage;

        if (currentImage.includes(':')) {
          const [repo, tag] = currentImage.split(':');
          const versionMatch = tag.match(/v(\d+)/);
          if (versionMatch) {
            const version = parseInt(versionMatch[1], 10);
            rollbackImage =
              version > 1 ? `${repo}:v${version - 1}` : `${repo}:latest`;
          } else {
            rollbackImage = `${repo}:latest`;
          }
        } else {
          rollbackImage = `${currentImage}:latest`;
        }

        // Standard local rollback: Stop the container and restart it
        await container.stop({ t: 5 }).catch(() => {});
        await container.start();
        return `Simulated rollback: Reverted container ${containerName} from ${currentImage} to ${rollbackImage} and started.`;
      }

      case 3: {
        // Scale action simulation: create a replica container copy
        const container = this.docker.getContainer(containerId);
        const inspect = await container.inspect();
        const replicaSuffix = Math.random().toString(36).substring(2, 6);
        const replicaName = `${containerName}-replica-${replicaSuffix}`;

        const replicaConfig = {
          Image: inspect.Config.Image,
          name: replicaName,
          HostConfig: {
            NetworkMode: inspect.HostConfig.NetworkMode,
          },
          Env: inspect.Config.Env,
        };

        const newContainer = await this.docker.createContainer(replicaConfig);
        await newContainer.start();
        return `Horizontal scaling executed: Spun up container replica ${replicaName}.`;
      }

      default:
        throw new Error(`Invalid action type: ${action}`);
    }
  }

  /**
   * Wait evaluation window, evaluate health, compute rewards, and save the episode.
   */
  private async evaluateRewardAndSaveEpisode(params: {
    event: DockerCrashEvent;
    serviceId: string;
    eventId: string;
    stateVector: number[];
    action: number;
    containerId: string;
    containerName: string;
  }): Promise<void> {
    const { event, stateVector, action, containerId, containerName } = params;
    this.logger.log(`Evaluating reward for container ${containerName}`);
    this.emitTerminalLog(
      'info',
      'RL Coordinator',
      `🧐 Evaluating healing reward post-execution for ${containerName}...`,
    );

    let isHealthy = false;
    try {
      const container = this.docker.getContainer(containerId);
      const inspect = await container.inspect();
      isHealthy =
        inspect.State.Running &&
        !inspect.State.Restarting &&
        inspect.State.ExitCode === 0;
    } catch {
      isHealthy = false;
    }

    // Reward Schema: Healthy = +10, Crashed/Stopped = -15, step penalty = -1
    let reward = isHealthy ? 10.0 : -15.0;
    reward -= 1.0; // step penalty

    this.emitTerminalLog(
      isHealthy ? 'info' : 'error',
      'RL Coordinator',
      `📊 Healing Evaluation: Container status is [${isHealthy ? 'RUNNING' : 'CRASHED/STOPPED'}]. Reward assigned: ${reward}`,
    );

    // Get final next state logs and embeddings
    let nextLogs = '';
    try {
      const container = this.docker.getContainer(containerId);
      const logBuffer = await container.logs({
        stdout: true,
        stderr: true,
        tail: 50,
        timestamps: false,
      });
      nextLogs = logBuffer
        .toString('utf8')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .trim();
    } catch {
      nextLogs = 'Container is stopped or missing';
    }

    const nextEmbedding = await this.embeddingService.getEmbedding(nextLogs);
    const nextOom = !isHealthy && event.eventType === 'oom' ? 1.0 : 0.0;
    const nextExitCode = isHealthy ? 0.0 : 1.0 / 255.0;
    const nextStateVector = [...nextEmbedding, nextOom, nextExitCode];

    // Save episode to MongoDB Replay Buffer
    try {
      const episode = await this.mongoService.EpisodeModel.create({
        state_vector: stateVector,
        action_taken: action,
        reward,
        next_state_vector: nextStateVector,
        timestamp: new Date(),
        containerName,
        imageName: event.imageName,
        exitCode: event.exitCode ?? 0,
        eventType: event.eventType,
      });

      this.logger.log(`Episode committed successfully. ID: ${episode._id}`);

      // Update Service model final state
      await this.mongoService.ServiceModel.updateOne(
        { containerId },
        { status: isHealthy ? 'HEALTHY' : 'CRASHED', lastSeenAt: new Date() },
      );

      // Broadcast update to client dashboard
      this.gateway.broadcast(WsEventName.REMEDIATION_COMPLETE, {
        eventId: params.eventId,
        planId: null,
        executionId: null,
        action: this.getActionName(action).toLowerCase(),
        success: isHealthy,
        reward,
        timestamp: new Date().toISOString(),
      });

      this.gateway.broadcast('rl:episode-saved', {
        episodeId: episode._id,
        containerName,
        action,
        reward,
        isHealthy,
        timestamp: new Date().toISOString(),
      });
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      this.logger.error(`Failed to commit episode to Mongo database: ${msg}`);
    }
  }

  /**
   * Forward manual training request to Python Brain microservice.
   */
  async triggerManualTraining(): Promise<any> {
    const url = `${this.rlBrainUrl}/train`;
    this.emitTerminalLog(
      'info',
      'RL Coordinator',
      `⚙️ Requesting MANUAL training session from Python RL Brain...`,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Aegis-Auth-Token': this.authToken,
        },
      });

      if (!response.ok) {
        throw new Error(`Training endpoint returned HTTP ${response.status}`);
      }

      const result = await response.json();
      this.emitTerminalLog(
        'info',
        'RL Coordinator',
        `✅ Manual training completed: ${JSON.stringify(result)}`,
      );
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Manual training trigger failed: ${msg}`);
      this.emitTerminalLog(
        'error',
        'RL Coordinator',
        `❌ Training failed: ${msg}`,
      );
      throw err;
    }
  }

  private getActionName(action: number): string {
    const actions = ['DO_NOTHING', 'RESTART', 'ROLLBACK', 'SCALE'];
    return actions[action] ?? 'UNKNOWN';
  }

  private emitTerminalLog(
    level: 'info' | 'warn' | 'error' | 'ai',
    source: string,
    message: string,
  ): void {
    this.gateway.broadcast(WsEventName.TERMINAL_LOG, {
      id: randomUUID(),
      level,
      source,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
