// ─────────────────────────────────────────────────────────────────────────────
// Docker Event Data Contracts
// Every object flowing through Docker → Queue → AI → DB is strictly typed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw Docker engine event as received from the dockerode event stream.
 * We listen for crash and health events on containers.
 */
export interface RawDockerEvent {
  readonly Type: string;
  readonly Action: string;
  readonly Actor: {
    readonly ID: string;
    readonly Attributes: {
      readonly name: string;
      readonly image: string;
      readonly exitCode?: string;
      readonly [key: string]: string | undefined;
    };
  };
  readonly time: number;
  readonly timeNano: number;
}

/**
 * Normalized crash event after extraction from the raw Docker stream.
 * This is the canonical shape that flows through the entire pipeline.
 */
export interface DockerCrashEvent {
  readonly containerId: string;
  readonly containerName: string;
  readonly imageName: string;
  readonly exitCode: number;
  readonly eventType: 'die' | 'oom' | 'kill' | 'health_status';
  readonly timestamp: Date;
  readonly logs: string;
  readonly metadata: Record<string, unknown>;
}

/**
 * Container info snapshot at the time of crash.
 */
export interface ContainerSnapshot {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly state: string;
  readonly status: string;
  readonly restartCount: number;
  readonly createdAt: string;
  readonly ports: ReadonlyArray<{
    readonly IP: string;
    readonly PrivatePort: number;
    readonly PublicPort: number;
    readonly Type: string;
  }>;
}
