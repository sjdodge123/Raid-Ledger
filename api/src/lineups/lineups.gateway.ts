import { Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type * as schema from '../drizzle/schema';
import { socketAuthMiddleware } from '../auth/socket-auth.helpers';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  LineupGraceScheduledEventSchema,
  LineupRealtimeEventNames,
  LineupScheduleChangedEventSchema,
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
 * Auth: JWT from socket.handshake.auth.token, validated by a namespace
 * middleware BEFORE the socket connects, with the same session checks as
 * HTTP (`auth/socket-auth.helpers.ts`); a refused handshake never connects.
 * Note: Single-instance only for v1. Redis adapter is optional and documented.
 */
// CORS is decided per handshake by SocketCorsIoAdapter (cors/socket-cors.ts).
@WebSocketGateway({ namespace: '/lineups' })
export class LineupsGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(LineupsGateway.name);

  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @WebSocketServer()
  server!: Server;

  /**
   * JWT + the HTTP session checks (token version, ban, deactivation) as a
   * handshake middleware: a refused socket gets `next(err)` and never connects.
   */
  afterInit(server: Server): void {
    server.use(
      socketAuthMiddleware({
        jwtService: this.jwtService,
        db: this.db,
        logger: this.logger,
      }),
    );
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
   * Emit a grace-window scheduled event to clients watching the lineup
   * (ROK-1253). Pairs with the `emitStatusChange` that fires when the
   * grace job completes — together they let the banner appear AND
   * disappear without waiting for the lineup detail poll.
   */
  emitGraceScheduled(lineupId: number, pendingAdvanceAt: Date): void {
    const start = performance.now();
    const payload = LineupGraceScheduledEventSchema.parse({
      lineupId,
      pendingAdvanceAt: pendingAdvanceAt.toISOString(),
    });
    this.server
      .to(`lineup:${lineupId}`)
      .emit(LineupRealtimeEventNames.GraceScheduled, payload);
    perfLog(
      'WS',
      LineupRealtimeEventNames.GraceScheduled,
      performance.now() - start,
      { lineupId },
    );
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
  /**
   * Tell clients watching a lineup that a scheduling poll changed
   * (ROK-1551) — a vote, suggestion or lifecycle flip. Ids only: the client
   * re-reads the poll through the authorised REST endpoint, so a room member
   * learns nothing beyond "something changed".
   *
   * @param lineupId - The poll's parent lineup (the room).
   * @param matchId - The poll's match id.
   */
  emitScheduleChanged(lineupId: number, matchId: number): void {
    const start = performance.now();
    const payload = LineupScheduleChangedEventSchema.parse({
      lineupId,
      matchId,
    });
    this.server
      .to(`lineup:${lineupId}`)
      .emit(LineupRealtimeEventNames.ScheduleChanged, payload);
    perfLog(
      'WS',
      LineupRealtimeEventNames.ScheduleChanged,
      performance.now() - start,
      { lineupId, matchId },
    );
  }
}
