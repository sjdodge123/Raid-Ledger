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
} from '@raid-ledger/contract';
import type { UserRole } from '@raid-ledger/contract';
import { handleValidationError, isOperatorOrAdmin } from './controller.helpers';

interface AuthenticatedRequest {
  user: { id: number; role: import('@raid-ledger/contract').UserRole };
}

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
  ): Promise<{
    channelId: string | null;
    channelName: string | null;
    guildId: string | null;
  }> {
    const event = await this.eventsService.findOne(id);
    const channelId =
      event.notificationChannelOverride ??
      (await this.channelResolverService.resolveVoiceChannelForScheduledEvent(
        event.game?.id ?? null,
        event.recurrenceGroupId ?? null,
      ));
    if (!channelId) {
      return { channelId: null, channelName: null, guildId: null };
    }
    return this.resolveChannelName(channelId, !!req.user);
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

  private async resolveChannelName(
    channelId: string,
    isAuthenticated: boolean,
  ) {
    try {
      const guildId = this.discordBotClientService.getGuildId();
      const client = this.discordBotClientService.getClient();
      if (guildId && client) {
        const guild =
          client.guilds.cache.get(guildId) ??
          (await client.guilds.fetch(guildId));
        const channel =
          guild.channels.cache.get(channelId) ??
          (await guild.channels.fetch(channelId));
        return {
          channelId,
          channelName: channel?.name ?? null,
          guildId: isAuthenticated ? guildId : null,
        };
      }
    } catch {
      // Discord API failure — return ID without name
    }
    return { channelId, channelName: null, guildId: null };
  }
}
