import { Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
 * Auth: JWT from socket.handshake.auth.token (validated on connection).
 * Note: Single-instance only for v1. Redis adapter is optional and documented.
 */
@WebSocketGateway({
  namespace: '/ad-hoc',
  cors: {
    origin: process.env.CLIENT_URL || '*',
    credentials: true,
  },
})
export class AdHocEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AdHocEventsGateway.name);

  constructor(@Inject(JwtService) private readonly jwtService: JwtService) {}

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    const token = (client.handshake.auth as Record<string, unknown> | undefined)
      ?.token;

    if (!token || typeof token !== 'string') {
      this.logger.debug(
        `Client ${client.id} rejected: no auth token provided`,
      );
      client.disconnect(true);
      return;
    }

    try {
      this.jwtService.verify(token);
      this.logger.debug(`Client ${client.id} connected with valid token`);
    } catch {
      this.logger.debug(
        `Client ${client.id} rejected: invalid auth token`,
      );
      client.disconnect(true);
    }
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
    this.server.to(`event:${eventId}`).emit('roster:update', {
      eventId,
      participants,
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
    this.server.to(`event:${eventId}`).emit('event:status', {
      eventId,
      status,
    });
  }

  /**
   * Emit end time extension.
   */
  emitEndTimeExtended(eventId: number, newEndTime: string): void {
    this.server.to(`event:${eventId}`).emit('event:endTimeExtended', {
      eventId,
      newEndTime,
    });
  }
}
