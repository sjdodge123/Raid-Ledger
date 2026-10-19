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
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { EventsService } from './events.service';
import { EventGuildTagService } from './event-guild-tag.service';
import { SignupsService } from './signups.service';
import { ShareService } from './share.service';
import {
  CreateEventSchema,
  UpdateEventSchema,
  UpdateEventReportLinkSchema,
  EventListQuerySchema,
  RescheduleEventSchema,
  CancelEventSchema,
  EventResponseDto,
  EventListResponseDto,
  DashboardResponseDto,
  AggregateGameTimeResponse,
  ShareEventResponseDto,
  type ActivityTimelineResponseDto,
} from '@raid-ledger/contract';
import type { PublicEventResponseDto } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { handleValidationError, isOperatorOrAdmin } from './controller.helpers';
import { assertSchedulingMatchUsable } from './event-poll-provenance.helpers';
import { ActivityLogService } from '../activity-log/activity-log.service';
import {
  findEventsForViewer,
  findEventForViewer,
  findEventActivityForViewer,
  type EventViewer,
  type PublicEventListResponseDto,
} from './events-public-read.helpers';
import { createEventWithSignups } from './event-create-lfg.helpers';
import { LfgEventConvertService } from '../lfg/lfg-event-convert.service';

/**
 * Core event CRUD controller.
 * Signup, roster, attendance, voice, and PUG endpoints live in
 * dedicated sub-controllers (events-signups, events-attendance, events-pugs).
 */
@Controller('events')
export class EventsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly eventsService: EventsService,
    private readonly signupsService: SignupsService,
    private readonly shareService: ShareService,
    private readonly activityLog: ActivityLogService,
    private readonly lfgEventConvert: LfgEventConvertService,
    private readonly guildTag: EventGuildTagService,
  ) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventResponseDto> {
    try {
      const dto = CreateEventSchema.parse(body);
      await this.guildTag.assertCreate(req.user, dto);
      await assertSchedulingMatchUsable(this.db, dto, {
        id: req.user.id,
        isStaff: isOperatorOrAdmin(req.user.role),
      });
      const deps = {
        eventsService: this.eventsService,
        signupsService: this.signupsService,
        lfgEventConvert: this.lfgEventConvert,
      };
      return await createEventWithSignups(deps, req.user.id, dto);
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Get()
  @UseGuards(OptionalJwtGuard)
  async findAll(
    @Query() query: Record<string, string>,
    @Request() req: { user?: NonNullable<EventViewer> },
  ): Promise<EventListResponseDto | PublicEventListResponseDto> {
    try {
      const dto = EventListQuerySchema.parse(query);
      return findEventsForViewer(this.eventsService, dto, req.user);
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
    @Request() req: { user?: NonNullable<EventViewer> },
  ): Promise<EventResponseDto | PublicEventResponseDto> {
    return findEventForViewer(this.db, this.eventsService, id, req.user);
  }

  @Get(':id/activity')
  @UseGuards(OptionalJwtGuard)
  async getActivity(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: NonNullable<EventViewer> },
  ): Promise<ActivityTimelineResponseDto> {
    return findEventActivityForViewer(this.activityLog, id, req.user);
  }

  @Get(':id/variant-context')
  @UseGuards(AuthGuard('jwt'))
  async getVariantContext(
    @Param('id', ParseIntPipe) eventId: number,
  ): Promise<{ gameVariant: string | null; region: string | null }> {
    return this.eventsService.getVariantContext(eventId);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventResponseDto> {
    try {
      const dto = UpdateEventSchema.parse(body);
      await this.guildTag.assertUpdate(req.user, id, dto);
      return await this.eventsService.update(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  /** ROK-1725: set (`null` clears) the report link; emits no event update. */
  @Patch(':id/report-link')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async updateReportLink(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventResponseDto> {
    try {
      const dto = UpdateEventReportLinkSchema.parse(body);
      return await this.eventsService.updateReportLink(
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
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
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
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
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
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
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
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
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

  @Post(':id/share')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
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
