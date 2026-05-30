'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { getSocket, disconnectSocket } from '@/lib/socket';
import type { Socket } from 'socket.io-client';
import type {
  WsTerminalLog,
  WsHeartbeat,
  ServiceNode,
} from '@/types';

// Updated interfaces matching Postgres-Prisma and Custom AI schemas
export interface WsIncidentDetected {
  readonly id: string;
  readonly containerId: string;
  readonly containerName: string;
  readonly imageName: string;
  readonly eventType: string;
  readonly exitCode: number;
  readonly logs: string;
  readonly timestamp: string;
}

export interface WsAiAnalysisCompleted {
  readonly eventId: string;
  readonly planId: string;
  readonly incidentType: string;
  readonly analysis: string;
  readonly confidenceScore: number;
  readonly riskLevel: 'LOW' | 'HIGH';
  readonly suggestedAction: 'RESTART_CONTAINER' | 'STOP_CONTAINER' | 'IGNORE';
  readonly reasoning: string;
  readonly similarIncidents?: any[];
}

export interface WsRemediationCompleted {
  readonly eventId: string;
  readonly planId: string;
  readonly actionTaken: string;
  readonly isSuccessful: boolean;
  readonly safetyPassed: boolean;
  readonly executionLogs: string;
  readonly durationMs: number;
  readonly timestamp: string;
}

interface UseSocketReturn {
  connected: boolean;
  uptime: number;
  nodes: ServiceNode[];
  terminalLogs: WsTerminalLog[];
  recentEvents: WsIncidentDetected[];
  activeStreams: Map<string, string>;
}

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [uptime, setUptime] = useState(0);
  const [nodes, setNodes] = useState<Map<string, ServiceNode>>(new Map());
  const [terminalLogs, setTerminalLogs] = useState<WsTerminalLog[]>([]);
  const [recentEvents, setRecentEvents] = useState<WsIncidentDetected[]>([]);
  const [activeStreams, setActiveStreams] = useState<Map<string, string>>(new Map());

  const addTerminalLog = useCallback((log: WsTerminalLog) => {
    setTerminalLogs((prev) => {
      const next = [...prev, log];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  const upsertNode = useCallback(
    (
      containerId: string,
      update: Partial<ServiceNode> & { name: string; imageName: string },
    ) => {
      setNodes((prev) => {
        const next = new Map(prev);
        const existing = next.get(containerId);
        next.set(containerId, {
          id: existing?.id ?? containerId,
          containerId,
          status: 'UNKNOWN',
          exitCode: null,
          lastEvent: null,
          aiAnalysis: null,
          isAnalyzing: false,
          ...existing,
          ...update,
        });
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    if (typeof window !== 'undefined') {
      (window as any).__aegis_socket__ = socket;
    }

    // ── Connection Events ──────────────────────────────────────────────
    socket.on('connect', () => {
      setConnected(true);
      addTerminalLog({
        id: crypto.randomUUID(),
        level: 'info',
        source: 'WebSocket',
        message: '🔌 Connected to Aegis Relational Orchestrator backend',
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('disconnect', () => {
      setConnected(false);
      addTerminalLog({
        id: crypto.randomUUID(),
        level: 'warn',
        source: 'WebSocket',
        message: '⚠️ Disconnected from Aegis backend socket',
        timestamp: new Date().toISOString(),
      });
    });

    // ── Heartbeat ──────────────────────────────────────────────────────
    socket.on('system:heartbeat', (data: WsHeartbeat) => {
      setUptime(data.uptime);
    });

    // ── Incident Detected (Postgres Watchman Interceptor) ──────────────
    socket.on('incident.detected', (data: WsIncidentDetected) => {
      setRecentEvents((prev) => {
        const next = [data, ...prev];
        return next.length > 50 ? next.slice(0, 50) : next;
      });

      upsertNode(data.containerId, {
        name: data.containerName,
        imageName: data.imageName,
        status: 'CRASHED',
        exitCode: data.exitCode,
        isAnalyzing: true,
        lastEvent: {
          containerId: data.containerId,
          containerName: data.containerName,
          imageName: data.imageName,
          exitCode: data.exitCode,
          eventType: data.eventType.toLowerCase() as any,
          timestamp: data.timestamp,
          logs: data.logs,
          metadata: {},
        },
      });

      // Initialize terminal stream animation
      setActiveStreams((prev) => {
        const next = new Map(prev);
        next.set(
          data.id,
          `🚨 Incident ID: ${data.id}\nContainer: ${data.containerName}\nFailure Event: ${data.eventType.toUpperCase()} (Exit: ${data.exitCode})\n\n[ML PIPELINE] Initializing custom local sentence tokenization...\n[ML PIPELINE] Vectorizing log outputs to 384-dimension matrix...`
        );
        return next;
      });
    });

    // ── AI Analysis Completed (SentenceTransformers Classification) ────
    socket.on('ai.analysis.completed', (data: WsAiAnalysisCompleted) => {
      setActiveStreams((prev) => {
        const next = new Map(prev);
        const current = next.get(data.eventId) ?? '';
        next.set(
          data.eventId,
          current +
            `\n[ML PIPELINE] Running classification net query...\n\n🎯 Diagnosis Result: [${data.incidentType}]\n📊 Confidence Score: ${(data.confidenceScore * 100).toFixed(1)}%\n🔒 Safety Mappings: Suggested = ${data.suggestedAction} (Risk: ${data.riskLevel})\n📝 Reasoning: ${data.reasoning}\n🔎 Vector Memory: Found ${data.similarIncidents?.length ?? 0} similarity matches in local FAISS store.`
        );
        return next;
      });

      // Update analyzing node target
      setNodes((prev) => {
        const next = new Map(prev);
        for (const [key, node] of next) {
          if (node.isAnalyzing) {
            next.set(key, {
              ...node,
              isAnalyzing: false,
              aiAnalysis: {
                eventId: data.eventId,
                planId: data.planId,
                result: {
                  analysis: data.analysis,
                  confidenceScore: data.confidenceScore,
                  suggestedAction: {
                    type: data.suggestedAction.toLowerCase() as any,
                    command: `execute ${data.suggestedAction}`,
                    parameters: { riskLevel: data.riskLevel, reasoning: data.reasoning },
                  },
                },
                processingTimeMs: 120,
              },
            });
          }
        }
        return next;
      });
    });

    // ── Remediation Completed (Docker API Safe Mitigation) ─────────────
    socket.on('remediation.completed', (data: WsRemediationCompleted) => {
      setNodes((prev) => {
        const next = new Map(prev);
        for (const [key, node] of next) {
          if (node.status === 'CRASHED') {
            next.set(key, {
              ...node,
              status: data.isSuccessful ? 'HEALTHY' : 'DEGRADED',
            });
          }
        }
        return next;
      });
      
      // Store event on global window for page alerts
      if (typeof window !== 'undefined') {
        const customEvent = new CustomEvent('aegis:remediation:done', { detail: data });
        window.dispatchEvent(customEvent);
      }
    });

    // ── Terminal Logs ──────────────────────────────────────────────────
    socket.on('terminal:log', (data: WsTerminalLog) => {
      addTerminalLog(data);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('system:heartbeat');
      socket.off('incident.detected');
      socket.off('ai.analysis.completed');
      socket.off('remediation.completed');
      socket.off('terminal:log');
      disconnectSocket();
    };
  }, [addTerminalLog, upsertNode]);

  return {
    connected,
    uptime,
    nodes: Array.from(nodes.values()),
    terminalLogs,
    recentEvents,
    activeStreams,
  };
}
