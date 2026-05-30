// ─────────────────────────────────────────────────────────────────────────────
// BullMQ Job Payload Contracts
// ─────────────────────────────────────────────────────────────────────────────

import type { DockerCrashEvent } from './docker-event.interface.js';

/**
 * Priority levels for the remediation queue.
 * OOM events are treated as critical (highest priority).
 */
export enum JobPriority {
  CRITICAL = 1,
  HIGH = 2,
  MEDIUM = 3,
  LOW = 4,
}

/**
 * The payload shape placed onto the BullMQ remediation queue.
 * Contains the full crash context needed for AI analysis.
 */
export interface CrashJobPayload {
  readonly jobId: string;
  readonly serviceId: string | null;
  readonly event: DockerCrashEvent;
  readonly priority: JobPriority;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
}

/**
 * Result returned after a job has been processed.
 */
export interface JobProcessingResult {
  readonly jobId: string;
  readonly eventId: string;
  readonly planId: string | null;
  readonly executionId: string | null;
  readonly success: boolean;
  readonly processingTimeMs: number;
  readonly error: string | null;
}

/**
 * Queue health metrics for monitoring.
 */
export interface QueueHealthMetrics {
  readonly waiting: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly delayed: number;
  readonly paused: number;
}
