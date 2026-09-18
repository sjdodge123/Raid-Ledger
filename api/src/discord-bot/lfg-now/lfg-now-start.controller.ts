/**
 * `POST /lfg/:gameId/start-now` — ROK-1613.
 *
 * Its own controller in `discord-bot` rather than a method on `LfgController`:
 * the spawn path needs `EphemeralVoiceService`, and `discord-bot` imports
 * `lfg`, never the reverse (the reason `LfgNowSpawnService` lives here at all).
 * Nest routes by path, not by module, so this sits beside `/lfg/:gameId/convert`
 * on the wire exactly as the spec asks.
 */
import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { LfgStartNowResponseDto } from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../../auth/types';
import { LfgNowSpawnService } from './lfg-now-spawn.service';

@Controller('lfg')
@UseGuards(AuthGuard('jwt'))
export class LfgNowStartController {
  constructor(private readonly spawner: LfgNowSpawnService) {}

  /**
   * Start this group playing right now. 200 either way: a press on a game that
   * already has a live session ATTACHES to it (AC5) rather than 409-ing.
   *
   * @param gameId - The group's game.
   * @param req - Authenticated request; the caller is the starter.
   * @throws 403 when the caller holds no live intent on the game (AC6).
   */
  @Post(':gameId/start-now')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  startNow(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<LfgStartNowResponseDto> {
    return this.spawner.startNow(req.user.id, gameId);
  }
}
