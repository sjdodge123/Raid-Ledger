/**
 * ROK-1474 (D12) — the star route.
 *
 * A separate controller for the same reason `TieReadinessController` is one
 * (`tie-readiness.controller.ts:1-11`): `LineupsController` counts 282 of its
 * 300 permitted lines, so a route added there would breach the ESLint cap in
 * the commit that added it.
 */
import {
  BadRequestException,
  Body,
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
import { Request } from 'express';
import {
  SetStarSchema,
  type LineupDetailResponseDto,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import { LineupStarService } from './lineup-star.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string };
}

@Controller('lineups/:id')
@UseGuards(AuthGuard('jwt'))
export class LineupStarController {
  constructor(private readonly starService: LineupStarService) {}

  /**
   * POST /lineups/:id/star — set or clear the caller's top pick.
   * `{ gameId: null }` clears it; a voter may star nothing (AC1).
   */
  @Post('star')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async star(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = SetStarSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.starService.setStar(
      id,
      parsed.data.gameId,
      req.user.id,
      req.user.role,
    );
  }
}
