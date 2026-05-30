// ─────────────────────────────────────────────────────────────────────────────
// Frontend Type Definitions
// Mirrors the backend WebSocket event contracts.
// ─────────────────────────────────────────────────────────────────────────────

export type ServiceStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'CRASHED'
  | 'RESTARTING'
  | 'UNKNOWN';

export type EventType = 'DIE' | 'OOM' | 'KILL' | 'HEALTH_CHECK_FAIL';

export type ActionType =
  | 'restart'
  | 'scale'
  | 'rollback'
  | 'alert_only'
  | 'resource_limit_adjust';

export type RemediationStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'ai';

// ─── Docker Events ──────────────────────────────────────────────────────────

export interface DockerCrashEvent {
  readonly containerId: string;
  readonly containerName: string;
  readonly imageName: string;
  readonly exitCode: number;
  readonly eventType: 'die' | 'oom' | 'kill';
  readonly timestamp: string;
  readonly logs: string;
  readonly metadata: Record<string, unknown>;
}

// ─── WebSocket Payloads ─────────────────────────────────────────────────────

export interface WsContainerCrashPayload {
  readonly event: DockerCrashEvent;
  readonly serviceId: string | null;
  readonly eventId: string;
  readonly timestamp: string;
}

export interface WsAiStreamChunk {
  readonly eventId: string;
  readonly chunk: string;
  readonly isComplete: boolean;
}

export interface WsAiAnalysisComplete {
  readonly eventId: string;
  readonly planId: string;
  readonly result: {
    readonly analysis: string;
    readonly confidenceScore: number;
    readonly suggestedAction: {
      readonly type: ActionType;
      readonly command: string;
      readonly parameters: Record<string, unknown>;
    };
  };
  readonly processingTimeMs: number;
}

export interface WsRemediationPayload {
  readonly eventId: string;
  readonly planId: string;
  readonly executionId: string;
  readonly action: string;
  readonly success: boolean;
  readonly logs: string;
  readonly timestamp: string;
}

export interface WsTerminalLog {
  readonly id: string;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}

export interface WsHeartbeat {
  readonly uptime: number;
  readonly connectedClients: number;
  readonly timestamp: string;
}

// ─── UI State ───────────────────────────────────────────────────────────────

export interface ServiceNode {
  id: string;
  name: string;
  imageName: string;
  containerId: string;
  status: ServiceStatus;
  exitCode: number | null;
  lastEvent: DockerCrashEvent | null;
  aiAnalysis: WsAiAnalysisComplete | null;
  isAnalyzing: boolean;
}

export interface DashboardState {
  connected: boolean;
  uptime: number;
  nodes: Map<string, ServiceNode>;
  terminalLogs: WsTerminalLog[];
  activeAnalysis: Map<string, string>; // eventId -> accumulated AI output
  recentEvents: WsContainerCrashPayload[];
}
