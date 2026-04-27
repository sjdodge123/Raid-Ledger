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
import {
  LineupRealtimeEventNames,
  LineupStatusEventSchema,
  LineupTiebreakerOpenEventSchema,
} from '@raid-ledger/contract';
import type { LineupStatus } from '../drizzle/schema';
import { perfLog } from '../common/perf-logger';

/**
 * WebSocket gateway for real-time community lineup updates (ROK-1118).
 *
 * Namespace: /lineups
 * Events:
 * - lineup:status — lineup advanced phase (building → voting → decided / archived)
 *
 * Auth: JWT from socket.handshake.auth.token (validated on connection).
 * Note: Single-instance only for v1. Redis adapter is optional and documented.
 */
@WebSocketGateway({
  namespace: '/lineups',
  cors: {
    origin: process.env.CLIENT_URL || '*',
    credentials: true,
  },
})
export class LineupsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(LineupsGateway.name);

  constructor(@Inject(JwtService) private readonly jwtService: JwtService) {}

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    const token = (client.handshake.auth as Record<string, unknown> | undefined)
      ?.token;

    if (!token || typeof token !== 'string') {
      this.logger.debug(`Client ${client.id} rejected: no auth token provided`);
      client.disconnect(true);
      return;
    }

    try {
      this.jwtService.verify(token);
      this.logger.debug(`Client ${client.id} connected with valid token`);
    } catch {
      this.logger.debug(`Client ${client.id} rejected: invalid auth token`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client ${client.id} disconnected`);
  }

  /** Client subscribes to updates for a specific lineup. */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lineupId: number },
  ): void {
    const room = `lineup:${data.lineupId}`;
    void client.join(room);
    this.logger.debug(
      `Client ${client.id} subscribed to lineup ${data.lineupId}`,
    );
  }

  /** Client unsubscribes from lineup updates. */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lineupId: number },
  ): void {
    const room = `lineup:${data.lineupId}`;
    void client.leave(room);
  }

  /**
   * Emit a lineup status change to all clients watching the lineup.
   *
   * Validates the payload with `LineupStatusEventSchema` before broadcast
   * so a malformed call (e.g. unknown status string) fails fast in dev
   * instead of poisoning the wire.
   */
  emitStatusChange(
    lineupId: number,
    status: LineupStatus,
    statusChangedAt: Date,
  ): void {
    const start = performance.now();
    const payload = LineupStatusEventSchema.parse({
      lineupId,
      status,
      statusChangedAt: statusChangedAt.toISOString(),
    });
    this.server
      .to(`lineup:${lineupId}`)
      .emit(LineupRealtimeEventNames.Status, payload);
    perfLog('WS', LineupRealtimeEventNames.Status, performance.now() - start, {
      lineupId,
      status,
    });
  }

  /**
   * Emit a tiebreaker-open event to all clients watching the lineup
   * (ROK-1117). Validates the payload with `LineupTiebreakerOpenEventSchema`
   * before broadcast so a malformed call (e.g. unknown mode) fails fast.
   */
  emitTiebreakerOpen(
    lineupId: number,
    tiebreakerId: number,
    mode: 'bracket' | 'veto',
    roundDeadline?: Date | null,
  ): void {
    const start = performance.now();
    const payload = LineupTiebreakerOpenEventSchema.parse({
      lineupId,
      tiebreakerId,
      mode,
      roundDeadline: roundDeadline ? roundDeadline.toISOString() : undefined,
    });
    this.server
      .to(`lineup:${lineupId}`)
      .emit(LineupRealtimeEventNames.TiebreakerOpen, payload);
    perfLog(
      'WS',
      LineupRealtimeEventNames.TiebreakerOpen,
      performance.now() - start,
      { lineupId, tiebreakerId, mode },
    );
  }
}
