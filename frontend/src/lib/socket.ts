import { io, Socket } from 'socket.io-client';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  'http://localhost:3001';

let socket: Socket | null = null;

/**
 * Get or create a singleton Socket.io connection to the Aegis backend.
 * Connects to the /aegis namespace.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${BACKEND_URL}/aegis`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      autoConnect: true,
    });
  }

  return socket;
}

/**
 * Disconnect and clean up the socket instance.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
