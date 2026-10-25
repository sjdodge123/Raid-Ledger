/**
 * ROK-1941 — wiring for the hub media channel: the Leader binding routes
 * (`guilds/:id/media-channel`), the gateway listener and the shared
 * `HubMediaPostIngest` (live + L3 backfill). A module of its own, like
 * `ThreadMirrorModule`; nothing here is imported back by the bot.
 */
import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { GuildsCoreModule } from '../../guilds/guilds-core.module';
import { HubMediaChannelController } from '../../guilds/hub-media-channel.controller';
import { HubMediaChannelService } from '../../guilds/hub-media-channel.service';
import { HubMediaModule } from '../../hub-media/hub-media.module';
import { ChannelMirrorModule } from '../channel-mirror/channel-mirror.module';
import { DiscordBotModule } from '../discord-bot.module';
import { HubMediaBackfillService } from './hub-media-backfill.service';
import { HubMediaChannelListener } from './hub-media-channel.listener';
import { HubMediaChannelResolver } from './hub-media-channel.queries';
import { HubMediaHistorySource } from './hub-media-history.discord';
import { HubMediaPostIngest } from './hub-media-post.ingest';

@Module({
  imports: [
    DrizzleModule,
    DiscordBotModule,
    ChannelMirrorModule,
    GuildsCoreModule,
    HubMediaModule,
  ],
  controllers: [HubMediaChannelController],
  providers: [
    HubMediaChannelResolver,
    HubMediaChannelService,
    HubMediaPostIngest,
    HubMediaChannelListener,
    HubMediaHistorySource,
    HubMediaBackfillService,
  ],
  exports: [HubMediaPostIngest, HubMediaChannelResolver],
})
export class HubMediaChannelModule {}
