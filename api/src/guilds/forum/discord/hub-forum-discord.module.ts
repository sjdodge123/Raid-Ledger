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
import { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import { HubForumDiscordInboundListener } from './hub-forum-discord-inbound.listener';
import {
  HubForumDiscordPinGateway,
  HubForumDiscordPinSync,
} from './hub-forum-discord-pins';
import { HubForumDiscordRouteResolver } from './hub-forum-discord-route';
import { HubForumDiscordService } from './hub-forum-discord.service';

/**
 * ROK-2208 — hub Forum ↔ Discord forum sync (Core). L2 ships the binding;
 * the outbound/inbound/reconcile lanes add their providers here.
 */
@Module({
  imports: [DrizzleModule, DiscordBotModule, GuildsCoreModule, SettingsModule],
  controllers: [HubForumDiscordController, HubForumDiscordDemoTestController],
  providers: [
    HubForumDiscordGateway,
    HubForumDiscordService,
    HubForumDiscordOutboundGateway,
    HubForumDiscordOutboundService,
    HubForumDiscordOutboundListener,
    HubForumDiscordRouteResolver,
    HubForumDiscordPinGateway,
    HubForumDiscordPinSync,
    HubForumDiscordInboundIngest,
    HubForumDiscordInboundListener,
  ],
  exports: [
    HubForumDiscordGateway,
    HubForumDiscordOutboundService,
    HubForumDiscordInboundIngest,
  ],
})
export class HubForumDiscordModule implements OnModuleInit {
  /** CLAUDE.md plugin ownership: the sync is a Core ingest source. */
  onModuleInit(): void {
    registerHubIngestSource(CORE_PLUGIN_ID, 'hub-forum.discord-sync');
  }
}
