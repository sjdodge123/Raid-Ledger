import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { UsersModule } from '../users/users.module';
import { CharactersModule } from '../characters/characters.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { NotificationModule } from '../notifications/notification.module';
import { ItadModule } from '../itad/itad.module';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DiscordBotSettingsController } from './discord-bot-settings.controller';
import { LineupChannelSettingsController } from './lineup-channel-settings.controller';
import { DiscordMemberController } from './discord-member.controller';
import { DiscordUserController } from './discord-user.controller';
import { ChannelBindingsController } from './channel-bindings.controller';
import { DiscordEmbedFactory } from './services/discord-embed.factory';
import { ChannelResolverService } from './services/channel-resolver.service';
import { ChannelBindingsService } from './services/channel-bindings.service';
import { PugInviteService } from './services/pug-invite.service';
import { GameActivityService } from './services/game-activity.service';
import { AdHocEventService } from './services/ad-hoc-event.service';
import { AdHocParticipantService } from './services/ad-hoc-participant.service';
import { AdHocNotificationService } from './services/ad-hoc-notification.service';
import { DiscordEventListener } from './listeners/event.listener';
import { DiscordSyncListener } from './listeners/discord-sync.listener';
import { InteractionListener } from './listeners/interaction.listener';
import { SignupInteractionListener } from './listeners/signup-interaction.listener';
import { RescheduleResponseListener } from './listeners/reschedule-response.listener';
import { RoachOutInteractionListener } from './listeners/roach-out-interaction.listener';
import { DeparturePromoteListener } from './listeners/departure-promote.listener';
import { PugInviteListener } from './listeners/pug-invite.listener';
import { ActivityListener } from './listeners/activity.listener';
import { VoiceStateListener } from './listeners/voice-state.listener';
import {
  EmbedSyncQueueService,
  EMBED_SYNC_QUEUE,
} from './queues/embed-sync.queue';
import {
  AdHocGracePeriodQueueService,
  AD_HOC_GRACE_QUEUE,
} from './queues/ad-hoc-grace-period.queue';
import {
  DepartureGraceQueueService,
  DEPARTURE_GRACE_QUEUE,
} from './queues/departure-grace.queue';
import {
  EventLifecycleQueueService,
  EVENT_LIFECYCLE_QUEUE,
} from './queues/event-lifecycle.queue';
import { EmbedSyncProcessor } from './processors/embed-sync.processor';
import { AdHocGracePeriodProcessor } from './processors/ad-hoc-grace-period.processor';
import { DepartureGraceProcessor } from './processors/departure-grace.processor';
import { EventLifecycleProcessor } from './processors/event-lifecycle.processor';
import { DepartureGraceService } from './services/departure-grace.service';
import { RegisterCommandsService } from './commands/register-commands';
import { EventCreateCommand } from './commands/event-create.command';
import { EventsListCommand } from './commands/events-list.command';
import { RosterViewCommand } from './commands/roster-view.command';
import { BindCommand } from './commands/bind.command';
import { UnbindCommand } from './commands/unbind.command';
import { BindingsCommand } from './commands/bindings.command';
import { InviteCommand } from './commands/invite.command';
import { HelpCommand } from './commands/help.command';
import { EventLinkListener } from './listeners/event-link.listener';
import { SteamLinkListener } from './listeners/steam-link.listener';
import { DiscordEmojiService } from './services/discord-emoji.service';
import { EmbedPosterService } from './services/embed-poster.service';
import { EmbedSchedulerService } from './services/embed-scheduler.service';
import { ScheduledEventService } from './services/scheduled-event.service';
import { ScheduledEventReconciliationService } from './services/scheduled-event.reconciliation';
import { PresenceGameDetectorService } from './services/presence-game-detector.service';
import { VoiceAttendanceService } from './services/voice-attendance.service';
import { EventAutoExtendService } from './services/event-auto-extend.service';
import { AdHocReaperService } from './services/ad-hoc-reaper.service';
import { PlayingCommand } from './commands/playing.command';

@Module({
  imports: [
    EventEmitterModule,
    SettingsModule,
    forwardRef(() => UsersModule),
    forwardRef(() => EventsModule),
    forwardRef(() => AuthModule),
    forwardRef(() => NotificationModule),
    CharactersModule,
    CronJobModule,
    ItadModule,
    BullModule.registerQueue({ name: EMBED_SYNC_QUEUE }),
    BullModule.registerQueue({ name: AD_HOC_GRACE_QUEUE }),
    BullModule.registerQueue({ name: DEPARTURE_GRACE_QUEUE }),
    BullModule.registerQueue({ name: EVENT_LIFECYCLE_QUEUE }),
  ],
  controllers: [
    DiscordBotSettingsController,
    LineupChannelSettingsController,
    DiscordMemberController,
    DiscordUserController,
    ChannelBindingsController,
  ],
  providers: [
    DiscordBotService,
    DiscordBotClientService,
    DiscordEmbedFactory,
    DiscordEmojiService,
    ChannelResolverService,
    ChannelBindingsService,
    PugInviteService,
    AdHocEventService,
    AdHocParticipantService,
    AdHocNotificationService,
    DiscordEventListener,
    DiscordSyncListener,
    EmbedSyncQueueService,
    EmbedSyncProcessor,
    AdHocGracePeriodQueueService,
    AdHocGracePeriodProcessor,
    DepartureGraceQueueService,
    DepartureGraceProcessor,
    EventLifecycleQueueService,
    EventLifecycleProcessor,
    DepartureGraceService,
    InteractionListener,
    SignupInteractionListener,
    RescheduleResponseListener,
    RoachOutInteractionListener,
    DeparturePromoteListener,
    PugInviteListener,
    ActivityListener,
    VoiceStateListener,
    GameActivityService,
    PresenceGameDetectorService,
    VoiceAttendanceService,
    EventAutoExtendService,
    AdHocReaperService,
    EventLinkListener,
    SteamLinkListener,
    EmbedPosterService,
    EmbedSchedulerService,
    ScheduledEventService,
    ScheduledEventReconciliationService,
    RegisterCommandsService,
    EventCreateCommand,
    EventsListCommand,
    RosterViewCommand,
    BindCommand,
    UnbindCommand,
    BindingsCommand,
    InviteCommand,
    HelpCommand,
    PlayingCommand,
  ],
  exports: [
    DiscordBotService,
    DiscordBotClientService,
    DiscordEmbedFactory,
    DiscordEmojiService,
    DiscordEventListener,
    ChannelBindingsService,
    ChannelResolverService,
    PugInviteService,
    AdHocEventService,
    VoiceAttendanceService,
  ],
})
export class DiscordBotModule {}
