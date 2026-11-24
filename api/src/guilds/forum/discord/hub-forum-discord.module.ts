import { BullModule } from '@nestjs/bullmq';
import { Module, type OnModuleInit } from '@nestjs/common';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { DiscordBotModule } from '../../../discord-bot/discord-bot.module';
import { DrizzleModule } from '../../../drizzle/drizzle.module';
import { registerHubIngestSource } from '../../../hub-media/hub-media-ingest-sources';
import { SettingsModule } from '../../../settings/settings.module';
import { GuildsCoreModule } from '../../guilds-core.module';
import { EventDiscussionSignupLines } from '../event-discussion/event-discussion-signup-lines.service';
import { HubForumDiscordController } from './hub-forum-discord.controller';
import { HubForumDiscordDemoTestController } from './hub-forum-discord.demo-test.controller';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import { HubForumDiscordOutboundListener } from './hub-forum-discord-outbound.listener';
import { HubForumDiscordAnnounceListener } from './hub-forum-discord-announce.listener';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import { HubForumDiscordGateway } from './hub-forum-discord.gateway';
import { HubForumDiscordEventGate } from './hub-forum-discord-event-gate';
import {
  HubForumDiscordEventLockGateway,
  HubForumDiscordEventLockSweep,
} from './hub-forum-discord-event-lock';
import { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import { HubForumDiscordInboundListener } from './hub-forum-discord-inbound.listener';
import { HubForumDiscordNotices } from './hub-forum-discord-notice';
import {
  HubForumDiscordPinGateway,
  HubForumDiscordPinSync,
} from './hub-forum-discord-pins';
import { HubForumDiscordReconcileGateway } from './hub-forum-discord-reconcile.discord';
import { HubForumDiscordReconcileService } from './hub-forum-discord-reconcile';
import { HubForumDiscordRouteResolver } from './hub-forum-discord-route';
import { EventPlanningForumResolver } from './event-planning-forum.resolver';
import { EventPlanningForumAdmin } from './event-planning-forum.admin';
import { EventPlanningForumAdminController } from './event-planning-forum.admin.controller';
import { HubForumDiscordService } from './hub-forum-discord.service';
import { HubForumDiscordDecor } from './hub-forum-discord-decor.apply';
import { HubForumBindLock } from './hub-forum-discord.bind-lock';
import { HubForumDiscordDecorBackfill } from './hub-forum-discord-decor.backfill';
import { ForumStarterBackfill } from './forum-starter.backfill';
import { EventPlanningForumRename } from './event-planning-forum.rename';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { EventPlanningPostsListener } from './event-planning-posts.listener';
import { EventPlanningPostsLockSweep } from './event-planning-posts.lock';
import { EventPlanningPostCreator } from './event-planning-posts.create';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import { EventPlanningSubjectsListener } from './event-planning-subjects.listener';
import { HubForumDiscordSignupPings } from './hub-forum-discord-signup-pings.service';
import { HubForumDiscordSignupPingCatchUp } from './hub-forum-discord-signup-pings.catch-up';
import { HubForumDiscordSignupPingListener } from './hub-forum-discord-signup-pings.listener';
import { HubForumDiscordSignupPingProcessor } from './hub-forum-discord-signup-pings.processor';
import {
  HubForumDiscordSignupPingQueue,
  SIGNUP_PING_QUEUE,
} from './hub-forum-discord-signup-pings.queue';
import { HubForumDiscordClosingLines } from './hub-forum-discord-closing-lines.service';
import { HubForumDiscordSubjectListener } from './hub-forum-discord-subject.listener';
import { HubForumDiscordPollVoterPings } from './hub-forum-discord-poll-voter-pings.service';
import { ForumStarterEditor } from './forum-starter-edit.port';
import { FORUM_STARTER_EDIT_PORT } from '../../../discord-bot/services/event-embed-message.editor';
import { SchedulingPollForumCard } from '../../../lineups/scheduling/scheduling-poll-forum-card';
import {
  SCHEDULING_POLL_EMBED_QUEUE,
  SchedulingPollEmbedQueueService,
} from '../../../lineups/scheduling/scheduling-poll-embed.queue';
import { POLL_FORUM_STARTER_PORT } from '../../../lineups/scheduling/poll-forum-starter.port';
import { EVENT_POST_REOPEN_PORT } from '../../../lineups/standalone-poll/event-post-reopen.port';
import { EventPostReopener } from './event-post-reopener';
import { PollForumStarterSync } from './poll-forum-starter.sync';
import { PollVoterLines } from './poll-voter-lines.refresh';
import {
  FORUM_CHAT_COPY_QUEUE,
  ForumChatCopyQueue,
} from './forum-chat-copy.queue';
import { ForumChatCopyListener } from './forum-chat-copy.listener';
import { ForumChatCopyProcessor } from './forum-chat-copy.processor';

/**
 * ROK-2208 — hub Forum ↔ Discord forum sync (Core). L2 ships the binding;
 * the outbound/inbound/reconcile lanes add their providers here.
 */
@Module({
  imports: [
    DrizzleModule,
    DiscordBotModule,
    GuildsCoreModule,
    SettingsModule,
    BullModule.registerQueue({ name: SIGNUP_PING_QUEUE }),
    // ROK-2295 Codex P2: a new poll post re-runs the coalesced card sync.
    BullModule.registerQueue({ name: SCHEDULING_POLL_EMBED_QUEUE }),
    BullModule.registerQueue({ name: FORUM_CHAT_COPY_QUEUE }),
  ],
  controllers: [
    HubForumDiscordController,
    HubForumDiscordDemoTestController,
    EventPlanningForumAdminController,
  ],
  providers: [
    HubForumDiscordGateway,
    HubForumBindLock,
    HubForumDiscordService,
    HubForumDiscordOutboundGateway,
    // ROK-2292 D4: the bot's embed editor resolves this token lazily.
    ForumStarterEditor,
    { provide: FORUM_STARTER_EDIT_PORT, useExisting: ForumStarterEditor },
    // ROK-2295: poll posts open with (and keep) the live poll embed.
    SchedulingPollForumCard,
    SchedulingPollEmbedQueueService,
    PollForumStarterSync,
    PollVoterLines,
    { provide: POLL_FORUM_STARTER_PORT, useExisting: PollForumStarterSync },
    // ROK-2314: a reschedule lock-in reopens the event post before POLL_LOCKED_IN.
    EventPostReopener,
    { provide: EVENT_POST_REOPEN_PORT, useExisting: EventPostReopener },
    HubForumDiscordOutboundService,
    HubForumDiscordOutboundListener,
    // ROK-2292 D8: create the event's forum post when it is announced.
    HubForumDiscordAnnounceListener,
    HubForumDiscordRouteResolver,
    EventPlanningForumResolver,
    EventPlanningForumAdmin,
    HubForumDiscordPinGateway,
    HubForumDiscordPinSync,
    HubForumDiscordNotices,
    HubForumDiscordEventGate,
    HubForumDiscordInboundIngest,
    HubForumDiscordInboundListener,
    HubForumDiscordReconcileGateway,
    HubForumDiscordReconcileService,
    HubForumDiscordEventLockGateway,
    HubForumDiscordEventLockSweep,
    HubForumDiscordSignupPings,
    // ROK-2274: the same flush writes lines into the RL event thread.
    EventDiscussionSignupLines,
    HubForumDiscordSignupPingQueue,
    HubForumDiscordSignupPingListener,
    HubForumDiscordSignupPingProcessor,
    HubForumDiscordSignupPingCatchUp,
    // ROK-2272 S8: poll first-vote post + closing lines.
    HubForumDiscordClosingLines,
    HubForumDiscordSubjectListener,
    HubForumDiscordDecor,
    HubForumDiscordDecorBackfill,
    ForumStarterBackfill,
    EventPlanningForumRename,
    EventPlanningPostsGateway,
    EventPlanningPostsService,
    EventPlanningPostsListener,
    EventPlanningPostsLockSweep,
    EventPlanningPostCreator,
    EventPlanningSubjectPosts,
    EventPlanningSubjectsListener,
    // ROK-2272 S10: poll voter pings (hub + non-hub).
    HubForumDiscordPollVoterPings,
    // ROK-2297: copy earlier chat between an event and its poll.
    ForumChatCopyQueue,
    ForumChatCopyListener,
    ForumChatCopyProcessor,
  ],
  exports: [
    HubForumDiscordGateway,
    HubForumDiscordOutboundService,
    HubForumDiscordInboundIngest,
    HubForumDiscordReconcileService,
    HubForumDiscordEventLockSweep,
    HubForumDiscordSignupPings,
    // ROK-2272 S4 (event-planning posts) + S5a (admin forum card) inject it.
    EventPlanningForumResolver,
    // ROK-2272 S4a: non-hub event posts (S4b signup pings consume it).
    EventPlanningPostsGateway,
    EventPlanningPostsService,
    EventPlanningSubjectPosts,
  ],
})
export class HubForumDiscordModule implements OnModuleInit {
  /** CLAUDE.md plugin ownership: the sync is a Core ingest source. */
  onModuleInit(): void {
    registerHubIngestSource(CORE_PLUGIN_ID, 'hub-forum.discord-sync');
  }
}
