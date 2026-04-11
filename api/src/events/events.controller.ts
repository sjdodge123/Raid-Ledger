import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { EventsService } from './events.service';
import { EventSeriesService } from './event-series.service';
import { SignupsService } from './signups.service';
import { ShareService } from './share.service';
import {
  CreateEventSchema,
  UpdateEventSchema,
  EventListQuerySchema,
  RescheduleEventSchema,
  CancelEventSchema,
  UpdateSeriesSchema,
  CancelSeriesSchema,
  SeriesScopeSchema,
  EventResponseDto,
  EventListResponseDto,
  DashboardResponseDto,
  AggregateGameTimeResponse,
  ShareEventResponseDto,
  type ActivityTimelineResponseDto,
} from '@raid-ledger/contract';
import type { UserRole } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { handleValidationError, isOperatorOrAdmin } from './controller.helpers';
import { ActivityLogService } from '../activity-log/activity-log.service';

/**
 * Core event CRUD controller.
 * Signup, roster, attendance, voice, and PUG endpoints live in
 * dedicated sub-controllers (events-signups, events-attendance, events-pugs).
 */
@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly seriesService: EventSeriesService,
    private readonly signupsService: SignupsService,
    private readonly shareService: ShareService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventResponseDto> {
    try {
      const dto = CreateEventSchema.parse(body);
      const result = await this.eventsService.create(req.user.id, dto);
      const eventIds = result.allEventIds ?? [result.id];
      await Promise.all(
        eventIds.map((id) =>
          this.signupsService.signup(id, req.user.id, undefined, {
            skipEndedCheck: true,
          }),
        ),
      );
      const { allEventIds: _, ...event } = result;
      void _;
      return event;
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Get()
  @UseGuards(OptionalJwtGuard)
  async findAll(
    @Query() query: Record<string, string>,
    @Request() req: { user?: { id: number; role: UserRole } },
  ): Promise<EventListResponseDto> {
    try {
      const dto = EventListQuerySchema.parse(query);
      return this.eventsService.findAll(dto, req.user?.id);
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Get('my-dashboard')
  @UseGuards(AuthGuard('jwt'))
  async getMyDashboard(
    @Request() req: AuthenticatedRequest,
  ): Promise<DashboardResponseDto> {
    return this.eventsService.getMyDashboard(
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
  }

  @Get(':id')
  @UseGuards(OptionalJwtGuard)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: { id: number } },
  ): Promise<EventResponseDto> {
    return this.eventsService.findOneWithConflicts(id, req.user?.id ?? null);
  }

  @Get(':id/activity')
  async getActivity(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ActivityTimelineResponseDto> {
    return this.activityLog.getTimeline('event', id);
  }

  @Get(':id/variant-context')
  @UseGuards(AuthGuard('jwt'))
  async getVariantContext(
    @Param('id', ParseIntPipe) eventId: number,
  ): Promise<{ gameVariant: string | null; region: string | null }> {
    return this.eventsService.getVariantContext(eventId);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventResponseDto> {
    try {
      const dto = UpdateEventSchema.parse(body);
      return this.eventsService.update(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Get(':id/aggregate-game-time')
  @UseGuards(AuthGuard('jwt'))
  async getAggregateGameTime(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AggregateGameTimeResponse> {
    return this.eventsService.getAggregateGameTime(id);
  }

  @Patch(':id/reschedule')
  @UseGuards(AuthGuard('jwt'))
  async reschedule(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventResponseDto> {
    try {
      const dto = RescheduleEventSchema.parse(body);
      return this.eventsService.reschedule(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Patch(':id/cancel')
  @UseGuards(AuthGuard('jwt'))
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventResponseDto> {
    try {
      const dto = CancelEventSchema.parse(body ?? {});
      return this.eventsService.cancel(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    await this.eventsService.delete(
      id,
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
    return { message: 'Event deleted successfully' };
  }

  @Post(':id/invite-member')
  @UseGuards(AuthGuard('jwt'))
  async inviteMember(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: { discordId?: string },
  ): Promise<{ message: string }> {
    if (!body.discordId || typeof body.discordId !== 'string') {
      throw new BadRequestException('discordId is required');
    }
    return this.eventsService.inviteMember(
      eventId,
      req.user.id,
      isOperatorOrAdmin(req.user.role),
      body.discordId,
    );
  }

  @Patch(':id/series')
  @UseGuards(AuthGuard('jwt'))
  async updateSeries(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ message: string }> {
    try {
      const dto = UpdateSeriesSchema.parse(body);
      await this.seriesService.update(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto.scope,
        dto.data,
      );
      return { message: 'Series updated successfully' };
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Delete(':id/series')
  @UseGuards(AuthGuard('jwt'))
  async deleteSeries(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Query('scope') scope: string,
  ): Promise<{ message: string }> {
    try {
      const parsed = SeriesScopeSchema.parse(scope);
      await this.seriesService.delete(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        parsed,
      );
      return { message: 'Series deleted successfully' };
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Patch(':id/series/cancel')
  @UseGuards(AuthGuard('jwt'))
  async cancelSeries(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ message: string }> {
    try {
      const dto = CancelSeriesSchema.parse(body);
      await this.seriesService.cancel(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto.scope,
        dto,
      );
      return { message: 'Series cancelled successfully' };
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Post(':id/share')
  @UseGuards(AuthGuard('jwt'))
  async shareEvent(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<ShareEventResponseDto> {
    const event = await this.eventsService.findOne(eventId);
    if (event.creator.id !== req.user.id && !isOperatorOrAdmin(req.user.role)) {
      throw new BadRequestException(
        'Only event creator or admin/operator can share events',
      );
    }
    return this.shareService.shareToDiscordChannels(eventId);
  }
}
