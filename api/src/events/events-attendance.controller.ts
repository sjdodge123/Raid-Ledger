import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { AttendanceService } from './attendance.service';
import { EventsService } from './events.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { AdHocEventService } from '../discord-bot/services/ad-hoc-event.service';
import { AnalyticsService } from './analytics.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import {
  RecordAttendanceSchema,
  SignupResponseDto,
  AttendanceSummaryDto,
  VoiceSessionsResponseDto,
  VoiceAttendanceSummaryDto,
  EventMetricsResponseDto,
  AdHocRosterResponseDto,
  VoiceChannelResponseDto,
} from '@raid-ledger/contract';
import type { UserRole } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { handleValidationError, isOperatorOrAdmin } from './controller.helpers';
import { resolveVoiceChannelForEvent } from './voice-channel-resolver.helpers';

@Controller('events')
export class EventsAttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly eventsService: EventsService,
    private readonly voiceAttendanceService: VoiceAttendanceService,
    private readonly adHocEventService: AdHocEventService,
    private readonly analyticsService: AnalyticsService,
    private readonly channelResolverService: ChannelResolverService,
    private readonly discordBotClientService: DiscordBotClientService,
  ) {}

  @Get(':id/voice-sessions')
  @UseGuards(AuthGuard('jwt'))
  async getVoiceSessions(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<VoiceSessionsResponseDto> {
    await this.assertEventOwner(eventId, req, 'view voice sessions');
    return this.voiceAttendanceService.getVoiceSessions(eventId);
  }

  @Get(':id/voice-attendance')
  @UseGuards(AuthGuard('jwt'))
  async getVoiceAttendance(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<VoiceAttendanceSummaryDto> {
    await this.assertEventOwner(eventId, req, 'view voice attendance');
    return this.voiceAttendanceService.getVoiceAttendanceSummary(eventId);
  }

  @Get(':id/metrics')
  @UseGuards(AuthGuard('jwt'))
  async getEventMetrics(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<EventMetricsResponseDto> {
    await this.assertEventOwner(eventId, req, 'view event metrics');
    return this.analyticsService.getEventMetrics(eventId);
  }

  @Get(':id/ad-hoc-roster')
  @UseGuards(AuthGuard('jwt'))
  async getAdHocRoster(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdHocRosterResponseDto> {
    const event = await this.eventsService.findOne(id);
    if (event.isAdHoc) {
      return this.adHocEventService.getAdHocRoster(id);
    }
    return this.voiceAttendanceService.getActiveRoster(id);
  }

  @Get(':id/voice-channel')
  @UseGuards(OptionalJwtGuard)
  async getVoiceChannel(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: { id: number; role: UserRole } },
  ): Promise<VoiceChannelResponseDto> {
    const event = await this.eventsService.findOne(id);
    return resolveVoiceChannelForEvent(
      {
        channelResolver: this.channelResolverService,
        bot: this.discordBotClientService,
      },
      event,
      !!req.user,
    );
  }

  @Patch(':id/attendance')
  @UseGuards(AuthGuard('jwt'))
  async recordAttendance(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<SignupResponseDto> {
    try {
      const dto = RecordAttendanceSchema.parse(body);
      return this.attendanceService.recordAttendance(
        eventId,
        dto,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Get(':id/attendance')
  @UseGuards(AuthGuard('jwt'))
  async getAttendanceSummary(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<AttendanceSummaryDto> {
    return this.attendanceService.getAttendanceSummary(
      eventId,
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
  }

  private async assertEventOwner(
    eventId: number,
    req: AuthenticatedRequest,
    action: string,
  ): Promise<void> {
    const event = await this.eventsService.findOne(eventId);
    if (event.creator.id !== req.user.id && !isOperatorOrAdmin(req.user.role)) {
      throw new ForbiddenException(
        `Only event creator or admin/operator can ${action}`,
      );
    }
  }
}
