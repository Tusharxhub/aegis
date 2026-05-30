import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WS_NAMESPACE, HEARTBEAT_INTERVAL_MS } from '../common/constants/index.js';
import type { WsEventName } from '../common/interfaces/websocket-event.interface.js';

/**
 * AegisGateway — Socket.io WebSocket Gateway.
 *
 * Broadcasts live infrastructure events, AI analysis streams,
 * remediation execution logs, and terminal output to the frontend
 * Control Center.
 *
 * Namespace: /aegis
 * CORS: Configured for Next.js dev server and production origins.
 */
@WebSocketGateway({
  namespace: WS_NAMESPACE,
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      process.env.FRONTEND_URL ?? 'http://localhost:3000',
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class AegisGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(AegisGateway.name);
  private connectedClients = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly startTime = Date.now();

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  afterInit(): void {
    this.logger.log(`🔌 WebSocket Gateway initialized on namespace "${WS_NAMESPACE}"`);

    // Start heartbeat broadcast
    this.heartbeatInterval = setInterval(() => {
      this.server.emit('system:heartbeat', {
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        connectedClients: this.connectedClients,
        timestamp: new Date().toISOString(),
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  handleConnection(client: Socket): void {
    this.connectedClients++;
    this.logger.log(
      `📡 Client connected: ${client.id} (total: ${this.connectedClients})`,
    );

    // Send initial connection acknowledgment
    client.emit('connection:ack', {
      clientId: client.id,
      serverTime: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    });
  }

  handleDisconnect(client: Socket): void {
    this.connectedClients--;
    this.logger.log(
      `📡 Client disconnected: ${client.id} (total: ${this.connectedClients})`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Broadcasting
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Broadcast an event to all connected clients.
   */
  broadcast(event: WsEventName | string, payload: unknown): void {
    if (this.server) {
      this.server.emit(event, payload);
    }
  }

  /**
   * Send an event to a specific client.
   */
  sendToClient(clientId: string, event: string, payload: unknown): void {
    if (this.server) {
      this.server.to(clientId).emit(event, payload);
    }
  }

  /**
   * Get the current number of connected clients.
   */
  getConnectedClientsCount(): number {
    return this.connectedClients;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Client Messages
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle ping from client (connection health check).
   */
  @SubscribeMessage('client:ping')
  handlePing(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { timestamp: string },
  ): { event: string; data: { serverTime: string; clientTime: string } } {
    return {
      event: 'client:pong',
      data: {
        serverTime: new Date().toISOString(),
        clientTime: data.timestamp,
      },
    };
  }

  /**
   * Handle request for current system state snapshot.
   */
  @SubscribeMessage('client:request-state')
  handleStateRequest(
    @ConnectedSocket() client: Socket,
  ): void {
    client.emit('system:state-snapshot', {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      connectedClients: this.connectedClients,
      timestamp: new Date().toISOString(),
    });
  }
}
