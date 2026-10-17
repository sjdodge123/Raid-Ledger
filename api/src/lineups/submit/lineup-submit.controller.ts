/**
 * Lineup submit controller (ROK-1296, U4 SubmitBar).
 *
 * One POST route — `submit-votes`. `submit-nominations` is retired by
 * TDB:449: the building phase advances on its nomination count target, its
 * deadline or a manual advance, so nothing reads a nominations stamp.
 * `submit-scheduling` is retired by ROK-1544: tapping a slot IS the vote, and
 * the server stamps `scheduling_submitted_at` from the vote itself
 * (`scheduling-submitted-at.helpers.ts`).
 *
 * It mirrors the existing `lineups.controller.ts`
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
  SubmitVotesRequestSchema,
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
}
