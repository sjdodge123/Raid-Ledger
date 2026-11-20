import { BullModule } from '@nestjs/bullmq';
import { Module, type OnModuleInit } from '@nestjs/common';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { DiscordBotModule } from '../../../discord-bot/discord-bot.module';
import { DrizzleModule } from '../../../drizzle/drizzle.module';
import { registerHubIngestSource } from '../../../hub-media/hub-media-ingest-sources';
import { SettingsModule } from '../../../settings/settings.module';
import { GuildsCoreModule } from '../../guilds-core.module';
import { HubForumDiscordController } from './hub-forum-discord.controller';
import { HubForumDiscordDemoTestController } from './hub-forum-discord.demo-test.controller';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import { HubForumDiscordOutboundListener } from './hub-forum-discord-outbound.listener';
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
import { EventPlanningForumRename } from './event-planning-forum.rename';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { EventPlanningPostsListener } from './event-planning-posts.listener';
import { EventPlanningPostsLockSweep } from './event-planning-posts.lock';
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
    HubForumDiscordOutboundService,
    HubForumDiscordOutboundListener,
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
    HubForumDiscordSignupPingQueue,
    HubForumDiscordSignupPingListener,
    HubForumDiscordSignupPingProcessor,
    HubForumDiscordSignupPingCatchUp,
    // ROK-2272 S8: poll first-vote post + closing lines.
    HubForumDiscordClosingLines,
    HubForumDiscordSubjectListener,
    HubForumDiscordDecor,
    HubForumDiscordDecorBackfill,
    EventPlanningForumRename,
    EventPlanningPostsGateway,
    EventPlanningPostsService,
    EventPlanningPostsListener,
    EventPlanningPostsLockSweep,
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
  ],
})
export class HubForumDiscordModule implements OnModuleInit {
  /** CLAUDE.md plugin ownership: the sync is a Core ingest source. */
  onModuleInit(): void {
    registerHubIngestSource(CORE_PLUGIN_ID, 'hub-forum.discord-sync');
  }
}
