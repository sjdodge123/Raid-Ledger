import { Controller, Get, Inject, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameNotificationMuteListDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { AuthenticatedRequest } from '../auth/types';
import { listGameMutes } from './game-notification-mute.helpers';

/**
 * The viewer's muted games (ROK-1797). Served under `/notifications`, not
 * `/games`, so it can never race `GET /games/:id`.
 */
@Controller('notifications')
export class GameNotificationMutesController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** GET /notifications/game-mutes -- Muted games, ordered by name. */
  @Get('game-mutes')
  @UseGuards(AuthGuard('jwt'))
  async list(
    @Request() req: AuthenticatedRequest,
  ): Promise<GameNotificationMuteListDto> {
    return listGameMutes(this.db, req.user.id);
  }
}
