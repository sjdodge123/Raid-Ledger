/**
 * Controller for /users/me/game-time/* (current user's game time).
 * Extracted from users-me.controller.ts for file size compliance (ROK-1564).
 */
import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  ParseIntPipe,
  Param,
  UseGuards,
  Request,
  HttpCode,
  Header,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GameTimeService } from './game-time.service';
import {
  GameTimeTemplateInputSchema,
  GameTimeOverrideInputSchema,
  GameTimeAbsenceInputSchema,
} from '@raid-ledger/contract';
import {
  parseOrBadRequest,
  parseTzOffset,
  resolveWeekStart,
} from './users-controller.helpers';
import type { AuthenticatedRequest } from '../auth/types';

/** Controller for /users/me/game-time/* (current user). */
@Controller('users')
export class UsersMeGameTimeController {
  constructor(private readonly gameTimeService: GameTimeService) {}

  /** Get current user's game time (composite view). */
  @Get('me/game-time')
  @UseGuards(AuthGuard('jwt'))
  @Header('Cache-Control', 'private, max-age=120')
  async getMyGameTime(
    @Request() req: AuthenticatedRequest,
    @Query('week') week?: string,
    @Query('tzOffset') tzOffsetStr?: string,
  ) {
    const weekStart = resolveWeekStart(week);
    const result = await this.gameTimeService.getCompositeView(
      req.user.id,
      weekStart,
      parseTzOffset(tzOffsetStr),
    );
    return { data: result };
  }

  /** Save game time template. */
  @Put('me/game-time')
  @UseGuards(AuthGuard('jwt'))
  async saveMyGameTime(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const dto = parseOrBadRequest(GameTimeTemplateInputSchema, body);
    const result = await this.gameTimeService.saveTemplate(
      req.user.id,
      dto.slots,
    );
    return { data: result };
  }

  /**
   * Confirm game time is still accurate without editing it (ROK-1564).
   * Writes no template — stale means unconfirmed, not unedited.
   */
  @Patch('me/game-time/confirm')
  @UseGuards(AuthGuard('jwt'))
  async confirmMyGameTime(@Request() req: AuthenticatedRequest) {
    const { confirmedAt } = await this.gameTimeService.confirmGameTime(
      req.user.id,
    );
    return { data: { confirmedAt: confirmedAt.toISOString() } };
  }

  /** Save per-hour date-specific overrides. */
  @Put('me/game-time/overrides')
  @UseGuards(AuthGuard('jwt'))
  async saveMyOverrides(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const dto = parseOrBadRequest(GameTimeOverrideInputSchema, body);
    await this.gameTimeService.saveOverrides(req.user.id, dto.overrides);
    return { data: { success: true } };
  }

  /** Create an absence range. */
  @Post('me/game-time/absences')
  @UseGuards(AuthGuard('jwt'))
  async createAbsence(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const dto = parseOrBadRequest(GameTimeAbsenceInputSchema, body);
    const result = await this.gameTimeService.createAbsence(req.user.id, dto);
    return { data: result };
  }

  /** Delete an absence. */
  @Delete('me/game-time/absences/:id')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async deleteAbsence(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.gameTimeService.deleteAbsence(req.user.id, id);
  }

  /** List current + future absences for current user (ROK-1427). */
  @Get('me/game-time/absences')
  @UseGuards(AuthGuard('jwt'))
  async getAbsences(
    @Request() req: AuthenticatedRequest,
    @Query('tzOffset') tzOffsetStr?: string,
  ) {
    const data = await this.gameTimeService.getAbsences(
      req.user.id,
      parseTzOffset(tzOffsetStr),
    );
    return { data };
  }
}
