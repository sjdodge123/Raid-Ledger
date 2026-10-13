import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  GameServerCalendarQuerySchema,
  GameServerStatusQuerySchema,
  type GameServerCalendarQueryDto,
  type GameServerCalendarResponseDto,
  type GameServerStatusQueryDto,
  type GameServerStatusResponseDto,
} from '@raid-ledger/contract';
import { handleValidationError } from '../../common/validation.util';
import { GameServerCalendarService } from './game-server-calendar.service';

/** Game-server calendar + status feed (ROK-268) — any signed-in member, no admin gate. */
@Controller('game-servers')
@UseGuards(AuthGuard('jwt'))
export class GameServerCalendarController {
  constructor(private readonly service: GameServerCalendarService) {}

  @Get('calendar')
  async calendar(
    @Query() query: Record<string, string>,
  ): Promise<GameServerCalendarResponseDto> {
    let parsed: GameServerCalendarQueryDto;
    try {
      parsed = GameServerCalendarQuerySchema.parse(query);
    } catch (error) {
      handleValidationError(error);
    }
    return this.service.getCalendarItems(parsed);
  }

  @Get('status')
  async status(
    @Query() query: Record<string, string>,
  ): Promise<GameServerStatusResponseDto> {
    let parsed: GameServerStatusQueryDto;
    try {
      parsed = GameServerStatusQuerySchema.parse(query);
    } catch (error) {
      handleValidationError(error);
    }
    return this.service.getStatuses(parsed.gameIds);
  }
}
