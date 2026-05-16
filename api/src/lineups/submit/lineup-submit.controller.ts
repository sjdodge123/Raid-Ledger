/**
 * Lineup submit controller (ROK-1296, U4 SubmitBar).
 *
 * Three POST routes that mirror the existing `lineups.controller.ts`
 * authorization shape (`AuthGuard('jwt')` + `NotDeactivatedGuard`). Bodies
 * are validated via Zod safeParse for an explicit 400 when callers send
 * unexpected fields (the schemas use `.strict()`).
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
import {
  SubmitNominationsRequestSchema,
  SubmitVotesRequestSchema,
  SubmitSchedulingRequestSchema,
  type LineupDetailResponseDto,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import { LineupSubmitService } from './lineup-submit.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string };
}

@Controller('lineups')
@UseGuards(AuthGuard('jwt'))
export class LineupSubmitController {
  constructor(private readonly submitService: LineupSubmitService) {}

  /** POST /lineups/:id/submit-nominations — stamp nominations_submitted_at. */
  @Post(':id/submit-nominations')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async submitNominations(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = SubmitNominationsRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.submitService.submitNominations(id, req.user.id, req.user.role);
  }

  /** POST /lineups/:id/submit-votes — stamp votes_submitted_at. */
  @Post(':id/submit-votes')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async submitVotes(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = SubmitVotesRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.submitService.submitVotes(id, req.user.id, req.user.role);
  }

  /**
   * POST /lineups/:id/matches/:matchId/submit-scheduling — per-match-member
   * scheduling stamp. 403 if the user is not a member of the match.
   */
  @Post(':id/matches/:matchId/submit-scheduling')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async submitScheduling(
    @Param('id', ParseIntPipe) id: number,
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = SubmitSchedulingRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.submitService.submitScheduling(
      id,
      matchId,
      req.user.id,
      req.user.role,
    );
  }
}
