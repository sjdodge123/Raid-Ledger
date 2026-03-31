/**
 * Scheduling poll controller (ROK-965).
 * Endpoints for schedule poll page, slot suggestions, voting, and event creation.
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
  type SchedulePollPageResponseDto,
  type SchedulingBannerDto,
  type OtherPollsResponseDto,
  type AggregateGameTimeResponse,
} from '@raid-ledger/contract';
import { OptionalJwtGuard } from '../../auth/optional-jwt.guard';
import { SchedulingService } from './scheduling.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string } | null;
}

@Controller('lineups')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  /** GET /lineups/scheduling-banner — banner for events page. */
  @Get('scheduling-banner')
  @UseGuards(AuthGuard('jwt'))
  async getSchedulingBanner(
    @Req() req: AuthRequest,
  ): Promise<SchedulingBannerDto | null> {
    return this.schedulingService.getSchedulingBanner(req.user!.id);
  }

  /** GET /lineups/:lineupId/schedule/:matchId — full poll page. */
  @Get(':lineupId/schedule/:matchId')
  @UseGuards(OptionalJwtGuard)
  async getSchedulePoll(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Req() req: AuthRequest,
  ): Promise<SchedulePollPageResponseDto> {
    const userId = req.user?.id ?? null;
    return this.schedulingService.getSchedulePoll(matchId, userId);
  }

  /** POST /lineups/:lineupId/schedule/:matchId/suggest — suggest a slot. */
  @Post(':lineupId/schedule/:matchId/suggest')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.CREATED)
  async suggestSlot(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: unknown,
  ): Promise<{ id: number }> {
    const parsed = SuggestSlotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.schedulingService.suggestSlot(
      matchId,
      parsed.data.proposedTime,
    );
  }

  /** POST /lineups/:lineupId/schedule/:matchId/vote — toggle a vote. */
  @Post(':lineupId/schedule/:matchId/vote')
  @UseGuards(AuthGuard('jwt'))
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

  /** POST /lineups/:lineupId/schedule/:matchId/create-event — create event. */
  @Post(':lineupId/schedule/:matchId/create-event')
  @UseGuards(AuthGuard('jwt'))
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

  /** DELETE /lineups/:lineupId/schedule/:matchId/votes — retract all votes. */
  @Delete(':lineupId/schedule/:matchId/votes')
  @UseGuards(AuthGuard('jwt'))
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
