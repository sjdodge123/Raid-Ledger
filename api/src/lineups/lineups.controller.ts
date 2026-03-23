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
import { Roles } from '../auth/roles.decorator';
import {
  CreateLineupSchema,
  UpdateLineupStatusSchema,
  CommonGroundQuerySchema,
  NominateGameSchema,
  type LineupDetailResponseDto,
  type LineupBannerResponseDto,
  type CommonGroundResponseDto,
  type ActivityTimelineResponseDto,
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
  @UseGuards(RolesGuard)
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

  /** GET /lineups/active — current active lineup. */
  @Get('active')
  async getActive(): Promise<LineupDetailResponseDto> {
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
  ): Promise<LineupDetailResponseDto> {
    return this.lineupsService.findById(id);
  }

  /** POST /lineups/:id/nominate — add a game to a lineup. */
  @Post(':id/nominate')
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
    return this.lineupsService.nominate(id, parsed.data, req.user.id);
  }

  /** DELETE /lineups/:id/nominations/:gameId — remove a nomination. */
  @Delete(':id/nominations/:gameId')
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

  /** PATCH /lineups/:id/status — transition status (operator/admin). */
  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('operator')
  async transitionStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<LineupDetailResponseDto> {
    const parsed = UpdateLineupStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lineupsService.transitionStatus(id, parsed.data);
  }

  /** GET /lineups/:id/activity — activity timeline for a lineup. */
  @Get(':id/activity')
  async getActivity(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ActivityTimelineResponseDto> {
    return this.activityLog.getTimeline('lineup', id);
  }
}
