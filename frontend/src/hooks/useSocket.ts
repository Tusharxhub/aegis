'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { getSocket, disconnectSocket } from '@/lib/socket';
import type { Socket } from 'socket.io-client';
import type {
  WsContainerCrashPayload,
  WsAiStreamChunk,
  WsAiAnalysisComplete,
  WsRemediationPayload,
  WsTerminalLog,
  WsHeartbeat,
  ServiceNode,
} from '@/types';

interface UseSocketReturn {
  connected: boolean;
  uptime: number;
  nodes: ServiceNode[];
  terminalLogs: WsTerminalLog[];
  recentEvents: WsContainerCrashPayload[];
  activeStreams: Map<string, string>;
}

/**
 * Custom hook managing the entire Socket.io lifecycle and state.
 * Listens to all Aegis WebSocket events and maintains the dashboard state.
 */
export function useSocket(): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [uptime, setUptime] = useState(0);
  const [nodes, setNodes] = useState<Map<string, ServiceNode>>(new Map());
  const [terminalLogs, setTerminalLogs] = useState<WsTerminalLog[]>([]);
  const [recentEvents, setRecentEvents] = useState<WsContainerCrashPayload[]>([]);
  const [activeStreams, setActiveStreams] = useState<Map<string, string>>(new Map());

  const addTerminalLog = useCallback((log: WsTerminalLog) => {
    setTerminalLogs((prev) => {
      const next = [...prev, log];
      // Keep last 200 logs to prevent memory leaks
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

    // ── Connection Events ──────────────────────────────────────────────
    socket.on('connect', () => {
      setConnected(true);
      addTerminalLog({
        id: crypto.randomUUID(),
        level: 'info',
        source: 'WebSocket',
        message: '🔌 Connected to Aegis backend',
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('disconnect', () => {
      setConnected(false);
      addTerminalLog({
        id: crypto.randomUUID(),
        level: 'warn',
        source: 'WebSocket',
        message: '⚠️ Disconnected from Aegis backend',
        timestamp: new Date().toISOString(),
      });
    });

    // ── Heartbeat ──────────────────────────────────────────────────────
    socket.on('system:heartbeat', (data: WsHeartbeat) => {
      setUptime(data.uptime);
    });

    // ── Container Crash ────────────────────────────────────────────────
    socket.on('container:crash', (data: WsContainerCrashPayload) => {
      setRecentEvents((prev) => {
        const next = [data, ...prev];
        return next.length > 50 ? next.slice(0, 50) : next;
      });

      upsertNode(data.event.containerId, {
        name: data.event.containerName,
        imageName: data.event.imageName,
        status: 'CRASHED',
        exitCode: data.event.exitCode,
        lastEvent: data.event,
      });
    });

    // ── AI Analysis Start ──────────────────────────────────────────────
    socket.on('ai:analysis:start', (data: { eventId: string; containerName: string }) => {
      // Find the node by recent event
      setNodes((prev) => {
        const next = new Map(prev);
        for (const [key, node] of next) {
          if (node.lastEvent && node.status === 'CRASHED') {
            next.set(key, { ...node, isAnalyzing: true });
          }
        }
        return next;
      });

      setActiveStreams((prev) => {
        const next = new Map(prev);
        next.set(data.eventId, '');
        return next;
      });
    });

    // ── AI Analysis Stream ─────────────────────────────────────────────
    socket.on('ai:analysis:stream', (data: WsAiStreamChunk) => {
      setActiveStreams((prev) => {
        const next = new Map(prev);
        const current = next.get(data.eventId) ?? '';
        next.set(data.eventId, current + data.chunk);
        return next;
      });
    });

    // ── AI Analysis Complete ───────────────────────────────────────────
    socket.on('ai:analysis:complete', (data: WsAiAnalysisComplete) => {
      setNodes((prev) => {
        const next = new Map(prev);
        for (const [key, node] of next) {
          if (node.isAnalyzing) {
            next.set(key, {
              ...node,
              isAnalyzing: false,
              aiAnalysis: data,
            });
          }
        }
        return next;
      });
    });

    // ── Remediation Events ─────────────────────────────────────────────
    socket.on('remediation:complete', (data: WsRemediationPayload) => {
      if (data.success) {
        setNodes((prev) => {
          const next = new Map(prev);
          for (const [key, node] of next) {
            if (node.status === 'CRASHED') {
              next.set(key, { ...node, status: 'RESTARTING' });
            }
          }
          return next;
        });
      }
    });

    // ── Terminal Logs ──────────────────────────────────────────────────
    socket.on('terminal:log', (data: WsTerminalLog) => {
      addTerminalLog(data);
    });

    // Cleanup on unmount
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('system:heartbeat');
      socket.off('container:crash');
      socket.off('ai:analysis:start');
      socket.off('ai:analysis:stream');
      socket.off('ai:analysis:complete');
      socket.off('remediation:complete');
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
