import { Inject, Logger } from '@nestjs/common';
import { perfLog } from '../common/perf-logger';
import { JwtService } from '@nestjs/jwt';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type * as schema from '../drizzle/schema';
import { authenticateSocket } from '../auth/socket-auth.helpers';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { AdHocParticipantDto } from '@raid-ledger/contract';

/**
 * WebSocket gateway for real-time ad-hoc event updates (ROK-293).
 *
 * Namespace: /ad-hoc
 * Events:
 * - roster:update — participant join/leave
 * - event:status — ad-hoc status change (live/grace_period/ended)
 * - event:endTimeExtended — end time was extended
 *
 * Auth: JWT from socket.handshake.auth.token, validated on connection with
 * the same session checks as HTTP (`auth/socket-auth.helpers.ts`).
 * Note: Single-instance only for v1. Redis adapter is optional and documented.
 */
// CORS is decided per handshake by SocketCorsIoAdapter (cors/socket-cors.ts).
@WebSocketGateway({ namespace: '/ad-hoc' })
export class AdHocEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AdHocEventsGateway.name);

  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @WebSocketServer()
  server!: Server;

  /** JWT + the HTTP session checks (token version, ban, deactivation). */
  async handleConnection(client: Socket): Promise<void> {
    await authenticateSocket(client, {
      jwtService: this.jwtService,
      db: this.db,
      logger: this.logger,
    });
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client ${client.id} disconnected`);
  }

  /**
   * Client subscribes to updates for a specific event.
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: number },
  ): void {
    const room = `event:${data.eventId}`;
    void client.join(room);
    this.logger.debug(
      `Client ${client.id} subscribed to event ${data.eventId}`,
    );
  }

  /**
   * Client unsubscribes from event updates.
   */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: number },
  ): void {
    const room = `event:${data.eventId}`;
    void client.leave(room);
  }

  /**
   * Emit a roster update to all clients watching a specific event.
   */
  emitRosterUpdate(
    eventId: number,
    participants: AdHocParticipantDto[],
    activeCount: number,
  ): void {
    const start = performance.now();
    this.server.to(`event:${eventId}`).emit('roster:update', {
      eventId,
      participants,
      activeCount,
    });
    perfLog('WS', 'roster:update', performance.now() - start, {
      eventId,
      activeCount,
    });
  }

  /**
   * Emit an event status change.
   */
  emitStatusChange(
    eventId: number,
    status: 'live' | 'grace_period' | 'ended',
  ): void {
    const start = performance.now();
    this.server.to(`event:${eventId}`).emit('event:status', {
      eventId,
      status,
    });
    perfLog('WS', 'event:status', performance.now() - start, { eventId });
  }

  /**
   * Emit end time extension.
   */
  emitEndTimeExtended(eventId: number, newEndTime: string): void {
    const start = performance.now();
    this.server.to(`event:${eventId}`).emit('event:endTimeExtended', {
      eventId,
      newEndTime,
    });
    perfLog('WS', 'event:endTimeExtended', performance.now() - start, {
      eventId,
    });
  }
}
