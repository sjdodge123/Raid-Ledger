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
  Query,
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
  type ToggleScheduleVoteResponseDto,
  CreateEventFromSlotSchema,
  CancelSchedulePollSchema,
  type SchedulePollPageResponseDto,
  type OtherPollsResponseDto,
  type AggregateGameTimeResponse,
  type RemindVotersResponseDto,
  type RallyNonVotersResponseDto,
  RallyNonVotersRequestSchema,
  AddMatchMembersSchema,
} from '@raid-ledger/contract';
import { OptionalJwtGuard } from '../../auth/optional-jwt.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import { Roles } from '../../auth/roles.decorator';
import { SchedulingService } from './scheduling.service';
import { parseWeekStartQuery } from './scheduling-availability-query.helpers';
import { parseTzOffset } from '../../users/users-controller.helpers';
import { SchedulingRemindService } from './scheduling-remind.service';
import { SchedulingRallyService } from './scheduling-rally.service';
import {
  SchedulingMembersService,
  type AddMatchMembersResult,
} from './scheduling-members.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string } | null;
}

@Controller('lineups')
export class SchedulingController {
  constructor(
    private readonly schedulingService: SchedulingService,
    private readonly remindService: SchedulingRemindService,
    private readonly rallyService: SchedulingRallyService,
    private readonly membersService: SchedulingMembersService,
  ) {}

  /** GET /lineups/:lineupId/schedule/:matchId — full poll page. */
  @Get(':lineupId/schedule/:matchId')
  @UseGuards(OptionalJwtGuard)
  async getSchedulePoll(
    @Param('lineupId', ParseIntPipe) lineupId: number,
    @Param('matchId', ParseIntPipe) matchId: number,
    @Req() req: AuthRequest,
  ): Promise<SchedulePollPageResponseDto> {
    const userId = req.user?.id ?? null;
    return this.schedulingService.getSchedulePoll(
      lineupId,
      matchId,
      userId,
      // ROK-1545: `canVote` is role-aware — admins/operators may vote on a
      // private lineup they were never invited to.
      req.user?.role ?? null,
    );
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
      req.user?.role,
      // ROK-1550: suggesting auto-votes, so the suggestion's provenance is the
      // auto-vote's — same field the vote route passes through.
      parsed.data.source,
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
  ): Promise<ToggleScheduleVoteResponseDto> {
    const parsed = ToggleScheduleVoteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.schedulingService.toggleVote(
      parsed.data.slotId,
      req.user!.id,
      matchId,
      req.user!.role,
      parsed.data.stance,
      parsed.data.source,
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
      req.user!.role,
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

  /**
   * POST /lineups/:lineupId/schedule/:matchId/remind — manual nudge to
   * members who haven't voted yet (ROK-1395). Creator/admin/operator only
   * (enforced in the service); 1h per-match cooldown → 429.
   */
  @Post(':lineupId/schedule/:matchId/remind')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async remindVoters(
    @Param('lineupId', ParseIntPipe) lineupId: number,
    @Param('matchId', ParseIntPipe) matchId: number,
    @Req() req: AuthRequest,
  ): Promise<RemindVotersResponseDto> {
    return this.remindService.remindVoters(lineupId, matchId, {
      id: req.user!.id,
      role: req.user!.role,
    });
  }

  /**
   * POST /lineups/:lineupId/schedule/:matchId/rally — organiser nudge to
   * every member who still owes a vote on a future slot (ROK-1618).
   *
   * Organiser-only (enforced in the service, same predicate as lock-in); 6h
   * per-poll cooldown → 429. No `@Throttle`: the cooldown IS the rate limit,
   * matching `/remind`.
   *
   * ROK-1635: the optional `slotId` names the time card that was rallied. An
   * absent one still rallies the LEADING time, so a browser tab holding the
   * pre-ROK-1635 bundle (which posts no body at all) keeps working.
   */
  @Post(':lineupId/schedule/:matchId/rally')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async rallyNonVoters(
    @Param('lineupId', ParseIntPipe) lineupId: number,
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<RallyNonVotersResponseDto> {
    const parsed = RallyNonVotersRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.rallyService.rallyNonVoters(
      lineupId,
      matchId,
      { id: req.user!.id, role: req.user!.role },
      parsed.data.slotId,
    );
  }

  /**
   * POST /lineups/:lineupId/schedule/:matchId/members — explicitly enrol
   * members in this scheduling poll (ROK-1440). Creator/admin/operator only
   * (enforced in the service). Idempotent: re-adding an existing member is a
   * no-op, so a double-submit neither fails nor duplicates.
   */
  @Post(':lineupId/schedule/:matchId/members')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async addPollMembers(
    @Param('lineupId', ParseIntPipe) lineupId: number,
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<AddMatchMembersResult> {
    const parsed = AddMatchMembersSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.membersService.addMembers(
      lineupId,
      matchId,
      parsed.data.userIds,
      { id: req.user!.id, role: req.user!.role },
    );
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

  /**
   * GET /lineups/:lineupId/schedule/:matchId/availability — heatmap data.
   *
   * `?weekStart=` (ROK-1570) names the dated week the client is rendering, so
   * that week's signups and absences can be subtracted from the recurring
   * templates. Any instant is normalised to the Sunday 00:00 UTC that starts
   * its week; an absent or unparseable value falls back to the current week
   * rather than 400, since the heatmap is a read-only view.
   *
   * `?tzOffset=` (review fix) is the browser's `Date.getTimezoneOffset()` in
   * minutes. Templates and the grid are local wall clock but `events.duration`
   * is a UTC instant, so without it the subtraction lands on the wrong cell for
   * every non-UTC viewer. Absent or garbage → 0 (UTC).
   */
  @Get(':lineupId/schedule/:matchId/availability')
  @UseGuards(AuthGuard('jwt'))
  async getMatchAvailability(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Req() req: AuthRequest,
    @Query('weekStart') weekStart?: string,
    @Query('tzOffset') tzOffset?: string,
  ): Promise<AggregateGameTimeResponse> {
    return this.schedulingService.getMatchAvailability(
      matchId,
      req.user!.id,
      parseWeekStartQuery(weekStart),
      parseTzOffset(tzOffset),
    );
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
