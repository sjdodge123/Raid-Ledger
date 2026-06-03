import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import { Roles } from '../auth/roles.decorator';
import {
  AbortLineupSchema,
  CreateLineupSchema,
  UpdateLineupMetadataSchema,
  UpdateLineupStatusSchema,
  CommonGroundQuerySchema,
  NominateGameSchema,
  CastVoteSchema,
  AddInviteesSchema,
  TogglePublicShareSchema,
  type LineupDetailResponseDto,
  type LineupParticipantsResponseDto,
  type LineupBannerResponseDto,
  type LineupSummaryResponseDto,
  type CommonGroundResponseDto,
  type ActivityTimelineResponseDto,
  type GroupedMatchesResponseDto,
  type BandwagonJoinResponseDto,
} from '@raid-ledger/contract';
import { LineupsService } from './lineups.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string };
}

@Controller('lineups')
@UseGuards(AuthGuard('jwt'))
export class LineupsController {
  constructor(
    private readonly lineupsService: LineupsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** POST /lineups — create a new lineup (operator/admin). */
  @Post()
  @UseGuards(NotDeactivatedGuard, RolesGuard)
  @Roles('operator')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = CreateLineupSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.create(parsed.data, req.user.id);
  }

  /**
   * GET /lineups/active — every lineup currently in building or voting
   * status (ROK-1065). Returns an array (was singular pre-ROK-1065).
   * Not filtered by viewer — private lineups are read-open.
   */
  @Get('active')
  async getActive(): Promise<LineupSummaryResponseDto[]> {
    return this.lineupsService.findActive();
  }

  /** GET /lineups/banner — lightweight banner for Games page. */
  @Get('banner')
  async getBanner(): Promise<LineupBannerResponseDto | null> {
    return this.lineupsService.findBanner();
  }

  /** GET /lineups/common-ground — ownership overlap query. */
  @Get('common-ground')
  async getCommonGround(
    @Query() query: Record<string, string>,
  ): Promise<CommonGroundResponseDto> {
    const parsed = CommonGroundQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.getCommonGround(parsed.data);
  }

  /** GET /lineups/:id — lineup detail by ID. */
  @Get(':id')
  async getById(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    return this.lineupsService.findById(id, req.user.id);
  }

  /**
   * GET /lineups/:id/participants — roster for the hero button + modal
   * (ROK-1346). Read-open, same auth as `GET /lineups/:id`. 404 if the
   * lineup id doesn't exist.
   */
  @Get(':id/participants')
  async getParticipants(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LineupParticipantsResponseDto> {
    return this.lineupsService.getParticipants(id);
  }

  /** POST /lineups/:id/vote — toggle a vote on a game (ROK-936). */
  @Post(':id/vote')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async vote(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = CastVoteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.toggleVote(
      id,
      parsed.data.gameId,
      req.user.id,
      req.user.role,
    );
  }

  /** POST /lineups/:id/nominate — add a game to a lineup. */
  @Post(':id/nominate')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.CREATED)
  async nominate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = NominateGameSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.nominate(
      id,
      parsed.data,
      req.user.id,
      req.user.role,
    );
  }

  /** DELETE /lineups/:id/nominations/:gameId — remove a nomination. */
  @Delete(':id/nominations/:gameId')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeNomination(
    @Param('id', ParseIntPipe) id: number,
    @Param('gameId', ParseIntPipe) gameId: number,
    @Req() req: AuthRequest,
  ): Promise<void> {
    return this.lineupsService.removeNomination(id, gameId, {
      id: req.user.id,
      role: req.user.role,
    });
  }

  /** POST /lineups/:id/abort — force-archive a lineup (operator/admin) (ROK-1062). */
  @Post(':id/abort')
  @UseGuards(NotDeactivatedGuard, RolesGuard)
  @Roles('operator')
  @HttpCode(HttpStatus.OK)
  async abort(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = AbortLineupSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.abort(id, parsed.data, { id: req.user.id });
  }

  /** PATCH /lineups/:id/status — transition status (operator/admin). */
  @Patch(':id/status')
  @UseGuards(NotDeactivatedGuard, RolesGuard)
  @Roles('operator')
  async transitionStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = UpdateLineupStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.transitionStatus(id, parsed.data, req.user.id);
  }

  /**
   * PATCH /lineups/:id/metadata — update title/description (ROK-1063).
   * Allowed for admin/operator or the original creator.
   */
  @Patch(':id/metadata')
  @UseGuards(NotDeactivatedGuard)
  async updateMetadata(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = UpdateLineupMetadataSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.updateMetadata(id, parsed.data, {
      id: req.user.id,
      role: req.user.role,
    });
  }

  /** GET /lineups/:id/matches — grouped matches for decided view (ROK-937). */
  @Get(':id/matches')
  async getMatches(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GroupedMatchesResponseDto> {
    return this.lineupsService.getGroupedMatches(id);
  }

  /** POST /lineups/:id/matches/:matchId/join — bandwagon join (ROK-937). */
  @Post(':id/matches/:matchId/join')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async joinMatch(
    @Param('id', ParseIntPipe) id: number,
    @Param('matchId', ParseIntPipe) matchId: number,
    @Req() req: AuthRequest,
  ): Promise<BandwagonJoinResponseDto> {
    return this.lineupsService.bandwagonJoin(
      id,
      matchId,
      req.user.id,
      req.user.role,
    );
  }

  /** POST /lineups/:id/matches/:matchId/advance — operator advance (ROK-937). */
  @Post(':id/matches/:matchId/advance')
  @UseGuards(NotDeactivatedGuard, RolesGuard)
  @Roles('operator')
  @HttpCode(HttpStatus.OK)
  async advanceMatch(
    @Param('id', ParseIntPipe) id: number,
    @Param('matchId', ParseIntPipe) matchId: number,
  ): Promise<{ promoted: boolean }> {
    return this.lineupsService.advanceMatch(id, matchId);
  }

  /** GET /lineups/:id/activity — activity timeline for a lineup. */
  @Get(':id/activity')
  async getActivity(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ActivityTimelineResponseDto> {
    return this.activityLog.getTimeline('lineup', id);
  }

  /**
   * POST /lineups/:id/invitees — add one or more invitees (ROK-1065).
   * Admin/operator only.
   */
  @Post(':id/invitees')
  @UseGuards(NotDeactivatedGuard, RolesGuard)
  @Roles('operator')
  async addInvitees(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = AddInviteesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.addInvitees(
      id,
      parsed.data.userIds,
      req.user.id,
    );
  }

  /**
   * PATCH /lineups/:id/public-share — toggle the public-share flag (ROK-1067).
   * Operator-only. Disabling preserves the slug for re-enabling.
   */
  @Patch(':id/public-share')
  @UseGuards(NotDeactivatedGuard, RolesGuard)
  @Roles('operator')
  async togglePublicShare(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    const parsed = TogglePublicShareSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.togglePublicShare(
      id,
      parsed.data.enabled,
      req.user.id,
    );
  }

  /**
   * DELETE /lineups/:id/invitees/:userId — remove a single invitee (ROK-1065).
   * Admin/operator only.
   */
  @Delete(':id/invitees/:userId')
  @UseGuards(NotDeactivatedGuard, RolesGuard)
  @Roles('operator')
  async removeInvitee(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: AuthRequest,
  ): Promise<LineupDetailResponseDto> {
    return this.lineupsService.removeInvitee(id, userId, req.user.id);
  }
}
