import {
  Controller,
  Post,
  Delete,
  Param,
  Inject,
  NotFoundException,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameNotificationMuteResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { AuthenticatedRequest } from '../auth/types';
import { setGameMute } from '../notifications/game-notification-mute.helpers';

/**
 * Per-game notification bell (ROK-1797). Lives beside `IgdbController` under
 * `/games` but in its own file — that controller is near the size cap. The
 * mute is independent of the heart (want-to-play).
 */
@Controller('games')
@UseGuards(AuthGuard('jwt'))
export class GameNotificationMuteController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** POST /games/:id/notification-mute -- Mute per-game notifications. */
  @Post(':id/notification-mute')
  @HttpCode(HttpStatus.OK)
  async mute(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<GameNotificationMuteResponseDto> {
    const game = await this.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);
    if (game.length === 0) throw new NotFoundException('Game not found');
    await setGameMute(this.db, req.user.id, id, true);
    return { gameId: id, muted: true };
  }

  /** DELETE /games/:id/notification-mute -- Unmute; no 404 without a row. */
  @Delete(':id/notification-mute')
  @HttpCode(HttpStatus.OK)
  async unmute(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<GameNotificationMuteResponseDto> {
    await setGameMute(this.db, req.user.id, id, false);
    return { gameId: id, muted: false };
  }
}
