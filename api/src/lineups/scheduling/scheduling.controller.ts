/**
 * Scheduling poll controller (ROK-965).
 * Endpoints for schedule poll page, slot suggestions, voting, and event creation.
 *
 * ROUTE-SHADOW GUARD (ROK-1235): literal-segment routes are FORBIDDEN on this
 * controller — only `:lineupId/schedule/...` patterns. LineupsController
 * registers first under the same 'lineups' prefix with `@Get(':id')` +
 * ParseIntPipe, so any literal route added here (e.g. `@Get('archive')`) would
 * be shadowed and return 400. Put literal routes on a separate controller
 * (see scheduling-banner.controller.ts, which lives at /scheduling/banner).
 */
import {
  Controller,
  Delete,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  SuggestSlotSchema,
  ToggleScheduleVoteSchema,
  CreateEventFromSlotSchema,
  CancelSchedulePollSchema,
  type SchedulePollPageResponseDto,
  type OtherPollsResponseDto,
  type AggregateGameTimeResponse,
} from '@raid-ledger/contract';
import { OptionalJwtGuard } from '../../auth/optional-jwt.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import { Roles } from '../../auth/roles.decorator';
import { SchedulingService } from './scheduling.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string } | null;
}

@Controller('lineups')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  /** GET /lineups/:lineupId/schedule/:matchId — full poll page. */
  @Get(':lineupId/schedule/:matchId')
  @UseGuards(OptionalJwtGuard)
  async getSchedulePoll(
    @Param('lineupId', ParseIntPipe) lineupId: number,
    @Param('matchId', ParseIntPipe) matchId: number,
    @Req() req: AuthRequest,
  ): Promise<SchedulePollPageResponseDto> {
    const userId = req.user?.id ?? null;
    return this.schedulingService.getSchedulePoll(lineupId, matchId, userId);
  }

  /** POST /lineups/:lineupId/schedule/:matchId/suggest — suggest a slot. */
  @Post(':lineupId/schedule/:matchId/suggest')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  @HttpCode(HttpStatus.CREATED)
  async suggestSlot(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<{ id: number }> {
    const parsed = SuggestSlotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.schedulingService.suggestSlot(
      matchId,
      parsed.data.proposedTime,
      req.user?.id,
    );
  }

  /** POST /lineups/:lineupId/schedule/:matchId/vote — toggle a vote. */
  @Post(':lineupId/schedule/:matchId/vote')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async toggleVote(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<{ voted: boolean }> {
    const parsed = ToggleScheduleVoteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.schedulingService.toggleVote(
      parsed.data.slotId,
      req.user!.id,
      matchId,
    );
  }

  /**
   * POST /lineups/:lineupId/schedule/:matchId/create-event — create event.
   *
   * @deprecated Use POST /events with matchId param instead (ROK-1121).
   * Endpoint retained for smoke-test compatibility — full removal tracked
   * separately.
   */
  @Post(':lineupId/schedule/:matchId/create-event')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  @HttpCode(HttpStatus.CREATED)
  async createEventFromSlot(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<{ eventId: number }> {
    const parsed = CreateEventFromSlotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.schedulingService.createEventFromSlot(
      matchId,
      parsed.data.slotId,
      req.user!.id,
      parsed.data.recurring,
    );
  }

  /** POST /lineups/:lineupId/schedule/:matchId/cancel — cancel poll (operator). */
  @Post(':lineupId/schedule/:matchId/cancel')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard, RolesGuard)
  @Roles('operator')
  @HttpCode(HttpStatus.OK)
  async cancelPoll(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<{ ok: boolean }> {
    const parsed = CancelSchedulePollSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    await this.schedulingService.cancelPoll(
      matchId,
      req.user!.id,
      parsed.data.reason,
    );
    return { ok: true };
  }

  /** DELETE /lineups/:lineupId/schedule/:matchId/votes — retract all votes. */
  @Delete(':lineupId/schedule/:matchId/votes')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async retractAllVotes(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Req() req: AuthRequest,
  ): Promise<void> {
    await this.schedulingService.retractAllVotes(matchId, req.user!.id);
  }

  /** GET /lineups/:lineupId/schedule/:matchId/availability — heatmap data. */
  @Get(':lineupId/schedule/:matchId/availability')
  @UseGuards(AuthGuard('jwt'))
  async getMatchAvailability(
    @Param('matchId', ParseIntPipe) matchId: number,
  ): Promise<AggregateGameTimeResponse> {
    return this.schedulingService.getMatchAvailability(matchId);
  }

  /** GET /lineups/:lineupId/schedule/:matchId/other-polls — other polls. */
  @Get(':lineupId/schedule/:matchId/other-polls')
  @UseGuards(AuthGuard('jwt'))
  async getOtherPolls(
    @Param('lineupId', ParseIntPipe) lineupId: number,
    @Param('matchId', ParseIntPipe) matchId: number,
    @Req() req: AuthRequest,
  ): Promise<OtherPollsResponseDto> {
    return this.schedulingService.getOtherPolls(
      lineupId,
      matchId,
      req.user!.id,
    );
  }
}
