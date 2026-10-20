import { Module, type OnModuleInit } from '@nestjs/common';
import { ChannelMirrorModule } from '../discord-bot/channel-mirror/channel-mirror.module';
import { SettingsModule } from '../settings/settings.module';
import { GuildAccessService } from './guild-access.service';
import { GuildDiscordController } from './guild-discord.controller';
import { GuildDiscordService } from './guild-discord.service';
import { GuildEditorGuard } from './guild-editor.guard';
import { GuildEditorsService } from './guild-editors.service';
import { GuildLeaderGuard } from './guild-leader.guard';
import { GuildProfileService } from './guild-profile.service';
import { HubKindActiveGuard } from './hub-kind-active.guard';
import { HubOnboardingController } from './hub-onboarding.controller';
import { HubOnboardingService } from './hub-onboarding.service';
import { HubKindRegistry } from './hub-kind.registry';
import { HubEventTagger } from './hub-event-tagger';
import { HubMineController } from './hub-mine.controller';
import { HubNotificationMuteController } from './hub-notification-mute.controller';
import { HubController } from './hub.controller';
import { HubService } from './hub.service';
import { HubVisibleGuard } from './hub-visible.guard';
import { HubPostRelayService } from './posts/hub-post-relay.service';
import { HubPostsController } from './posts/hub-posts.controller';
import { HubPostsService } from './posts/hub-posts.service';
import { CommunityHubKindAdapter } from './community/community-hub-kind.adapter';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  EVENT_GUILD_TAGGER_KEY,
  EXTENSION_POINTS,
} from '../plugins/plugin-host/extension-points';

/**
 * ROK-1830 S2a: the game-agnostic guild hub core — access/ladder, editors,
 * profile and the Discord mirror. Game plugins import it and register their
 * hub kind under `EXTENSION_POINTS.HUB_KIND`. Core routes live at
 * `guilds/:id` (ROK-1831); `/plugins/wow/guilds/**` stay as WoW aliases.
 */
@Module({
  imports: [ChannelMirrorModule, SettingsModule],
  // Order matters (ROK-1831): the literal `guilds/onboarding` and
  // `guilds/mine` must register before `guilds/:id`.
  controllers: [
    HubOnboardingController,
    HubMineController,
    HubController,
    HubNotificationMuteController,
    GuildDiscordController,
    HubPostsController,
  ],
  providers: [
    GuildAccessService,
    GuildEditorGuard,
    GuildLeaderGuard,
    GuildEditorsService,
    GuildProfileService,
    GuildDiscordService,
    HubKindActiveGuard,
    HubKindRegistry,
    HubOnboardingService,
    HubService,
    HubVisibleGuard,
    HubEventTagger,
    HubPostRelayService,
    HubPostsService,
    CommunityHubKindAdapter,
  ],
  exports: [
    GuildAccessService,
    GuildEditorGuard,
    GuildLeaderGuard,
    GuildEditorsService,
    GuildProfileService,
    HubKindRegistry,
    HubOnboardingService,
    HubService,
    HubVisibleGuard,
    HubPostsService,
    CommunityHubKindAdapter,
  ],
})
export class GuildsCoreModule implements OnModuleInit {
  constructor(
    private readonly plugins: PluginRegistryService,
    private readonly tagger: HubEventTagger,
    private readonly communityHubs: CommunityHubKindAdapter,
  ) {}

  /** ROK-1831 Q2: core owns event tagging for every hub kind (no owner plugin). */
  onModuleInit(): void {
    this.plugins.registerAdapter(
      EXTENSION_POINTS.EVENT_GUILD_TAGGER,
      EVENT_GUILD_TAGGER_KEY,
      this.tagger,
    );
    // ROK-1870 A4: core owns `game_community` — no owner plugin, always live.
    this.plugins.registerAdapter(
      EXTENSION_POINTS.HUB_KIND,
      'game_community',
      this.communityHubs,
    );
  }
}
