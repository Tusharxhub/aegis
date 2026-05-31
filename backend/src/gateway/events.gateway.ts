import { Injectable, Logger } from '@nestjs/common';
import type { OperationalEventName } from '../common/interfaces/operational-event.interface.js';

/**
 * AegisGateway — headless event sink for infrastructure event fan-out.
 *
 * The platform is backend-only, so this service records structured runtime
 * events and preserves the previous API surface without any browser transport.
 */
@Injectable()
export class AegisGateway {
  private readonly logger = new Logger(AegisGateway.name);
  private readonly startTime = Date.now();

  /**
   * Record an event that used to be broadcast to a browser client.
   */
  broadcast(event: OperationalEventName | string, payload: unknown): void {
    this.logger.debug(
      `event=${event} uptime=${Math.floor((Date.now() - this.startTime) / 1000)} payload=${this.safeSerialize(payload)}`,
    );
  }

  /**
   * Preserve the old API surface without any client transport.
   */
  sendToClient(_clientId: string, event: string, payload: unknown): void {
    this.broadcast(event, payload);
  }

  /**
   * There are no connected browser clients in headless mode.
   */
  getConnectedClientsCount(): number {
    return 0;
  }

  private safeSerialize(payload: unknown): string {
    try {
      return JSON.stringify(payload);
    } catch {
      return '[unserializable-payload]';
    }
  }
}
