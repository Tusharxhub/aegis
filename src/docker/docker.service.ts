import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Docker from 'dockerode';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type {
  RawDockerEvent,
  DockerCrashEvent,
} from '../common/interfaces/docker-event.interface.js';
import {
  DOCKER_RECONNECT_INTERVAL_MS,
  DOCKER_MAX_RECONNECT_ATTEMPTS,
  MAX_LOG_LINES,
  isIgnoredContainerName,
} from '../common/constants/index.js';
import { KafkaProducerService } from '../kafka/kafka.producer.js';
import { KAFKA_TOPICS } from '../kafka/kafka.constants.js';

/**
 * DockerService — The Watcher.
 *
 * Connects to the host Docker socket and listens for container crash events
 * (`die`, `oom`). On crash detection:
 *   1. Extracts the last N lines of container logs.
 *   2. Normalizes the event into a DockerCrashEvent.
 *   3. Emits the event via NestJS EventEmitter2.
 *
 * The Docker socket WILL drop connections. This service implements exponential
 * backoff reconnection with jitter to handle flaky socket states.
 */
@Injectable()
export class DockerService implements OnModuleInit, OnModuleDestroy {
  private docker: Docker;
  private readonly logger = new Logger(DockerService.name);
  private eventStream: NodeJS.ReadableStream | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isShuttingDown = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly kafkaProducer: KafkaProducerService,
  ) {
    const socketPath =
      this.configService.get<string>('DOCKER_SOCKET_PATH') ??
      '/var/run/docker.sock';

    this.docker = new Docker({ socketPath });
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(
      'Aegis Watcher initializing — connecting to Docker socket...',
    );
    await this.connectAndListen();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventStream) {
      (
        this.eventStream as NodeJS.ReadableStream & { destroy?: () => void }
      ).destroy?.();
      this.eventStream = null;
    }

    this.logger.log('Docker watcher shut down gracefully.');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Connection & Reconnection
  // ─────────────────────────────────────────────────────────────────────────

  private async connectAndListen(): Promise<void> {
    try {
      // Verify Docker daemon is reachable
      await this.docker.ping();
      this.logger.log('Docker daemon is reachable.');

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      const stream = await this.docker.getEvents({
        filters: {
          type: ['container'],
          event: ['die', 'oom', 'kill', 'health_status'],
        },
      });

      this.eventStream = stream;
      this.reconnectAttempts = 0;

      this.logger.log(
        'Aegis is now actively monitoring infrastructure events.',
      );

      stream.on('data', (chunk: Buffer) => {
        this.handleRawEvent(chunk).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to process Docker event: ${msg}`);
        });
      });

      stream.on('error', (err: Error) => {
        this.logger.error(`Docker event stream error: ${err.message}`);
        this.scheduleReconnect();
      });

      stream.on('end', () => {
        if (!this.isShuttingDown) {
          this.logger.warn('Docker event stream ended unexpectedly.');
          this.scheduleReconnect();
        }
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown Docker error';
      this.logger.error(`Failed to connect to Docker socket: ${message}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Exponential backoff with jitter for Docker socket reconnection.
   * Base interval: 5s, max backoff: ~5 minutes.
   */
  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;

    if (this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= DOCKER_MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `❌ Exceeded ${DOCKER_MAX_RECONNECT_ATTEMPTS} reconnection attempts. Docker watcher is offline.`,
      );
      return;
    }

    this.reconnectAttempts++;
    const baseDelay = DOCKER_RECONNECT_INTERVAL_MS;
    const exponentialDelay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts - 1),
      300_000, // Cap at 5 minutes
    );
    const jitter = Math.random() * 1000;
    const delay = exponentialDelay + jitter;

    this.logger.warn(
      `Reconnecting to Docker socket in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${DOCKER_MAX_RECONNECT_ATTEMPTS})...`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.connectAndListen().catch(() => {
        /* Error already handled inside connectAndListen */
      });
    }, delay);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Processing
  // ─────────────────────────────────────────────────────────────────────────

  private async handleRawEvent(chunk: Buffer): Promise<void> {
    let raw: RawDockerEvent;
    try {
      raw = JSON.parse(chunk.toString('utf8')) as RawDockerEvent;
    } catch {
      this.logger.warn(
        `Received malformed Docker event (${chunk.length} bytes). Skipping.`,
      );
      return;
    }

    const containerName = raw.Actor.Attributes.name ?? 'unknown';

    // Skip Aegis infrastructure containers (prefix match, label opt-out, dynamic exclusions)
    if (
      isIgnoredContainerName(
        containerName,
        raw.Actor.Attributes as Record<string, string>,
      )
    ) {
      return;
    }

    const eventType = raw.Action.startsWith('health_status')
      ? 'health_status'
      : (raw.Action as 'die' | 'oom' | 'kill');
    const exitCode = parseInt(raw.Actor.Attributes.exitCode ?? '0', 10);

    // For health_status events, only process unhealthy transitions
    if (eventType === 'health_status') {
      const healthStatus = raw.Action.replace('health_status: ', '').trim();
      this.logger.warn(
        `Container [${containerName}] health transition detected: ${healthStatus}`,
      );

      // Only treat unhealthy as a crash-like event; ignore healthy/starting/none
      if (healthStatus !== 'unhealthy') {
        return;
      }
    } else {
      this.logger.warn(
        `CRITICAL: Container [${containerName}] — event: ${eventType}, exit code: ${exitCode}`,
      );
    }

    // Extract crash logs from the dead container
    const logs = await this.getContainerLogs(raw.Actor.ID);
    this.logger.error(`Extracted ${logs.length} chars of crash logs.`);

    const crashEvent: DockerCrashEvent = {
      containerId: raw.Actor.ID,
      containerName,
      imageName: raw.Actor.Attributes.image ?? 'unknown',
      exitCode,
      eventType,
      timestamp: new Date(raw.time * 1000),
      logs,
      metadata: { ...raw.Actor.Attributes },
    };

    void this.kafkaProducer.publish(KAFKA_TOPICS.CONTAINER_EVENTS, {
      eventType: 'CONTAINER_LIFECYCLE',
      source: 'watchman',
      correlationId: raw.Actor.ID,
      eventId: randomUUID(),
      payload: {
        eventId: randomUUID(),
        serviceId: null,
        containerId: crashEvent.containerId,
        containerName: crashEvent.containerName,
        imageName: crashEvent.imageName,
        action: crashEvent.eventType,
        exitCode: crashEvent.exitCode,
        detectedAt: crashEvent.timestamp.toISOString(),
        metadata: crashEvent.metadata,
      },
    });

    // Emit to the internal event bus (picked up by OrchestratorService)
    this.eventEmitter.emit('docker.crash', crashEvent);
  }

  /**
   * Extract the last N lines of logs from a container.
   * Handles the Docker multiplexed stream format.
   * Public to allow the controller to fetch logs via the proper API.
   */
  async getContainerLogs(containerId: string): Promise<string> {
    const container = this.docker.getContainer(containerId);
    try {
      const logBuffer = await container.logs({
        stdout: true,
        stderr: true,
        tail: MAX_LOG_LINES,
        timestamps: true,
      });

      // Docker multiplexed stream: strip control characters
      return (
        logBuffer
          .toString('utf8')
          // eslint-disable-next-line no-control-regex
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
          .trim()
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown log extraction error';
      this.logger.warn(
        `  Failed to extract logs for ${containerId}: ${message}`,
      );
      return `[LOG_EXTRACTION_FAILED] ${message}`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Docker API Actions (used by the Executor)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Restart a container by ID.
   */
  async restartContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.restart({ t: 10 });
    this.logger.log(`🔄 Container ${containerId} restarted.`);
  }

  /**
   * List all running containers (for the dashboard node map).
   */
  async listContainers(): Promise<Docker.ContainerInfo[]> {
    return this.docker.listContainers({ all: true });
  }

  /**
   * Get detailed inspect data for a container.
   */
  async inspectContainer(
    containerId: string,
  ): Promise<Docker.ContainerInspectInfo> {
    const container = this.docker.getContainer(containerId);
    return container.inspect();
  }
}
