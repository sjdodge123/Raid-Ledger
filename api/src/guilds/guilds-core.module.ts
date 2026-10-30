import { Module, type OnModuleInit } from '@nestjs/common';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ChannelMirrorModule } from '../discord-bot/channel-mirror/channel-mirror.module';
import { SettingsModule } from '../settings/settings.module';
import { HubWelcomeModule } from '../discord-bot/hub-welcome/hub-welcome.module';
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
import { setActiveHubKindsSource } from '../discord-bot/channel-lifecycle/hub-link.resolver';
import { HubEventTagger } from './hub-event-tagger';
import { HubMineController } from './hub-mine.controller';
import { HubNotificationMuteController } from './hub-notification-mute.controller';
import { HubController } from './hub.controller';
import { HubService } from './hub.service';
import { HubRenameService } from './hub-rename.service';
import { HubVisibleGuard } from './hub-visible.guard';
import { HubWidgetPrefsService } from './hub-widget-prefs.service';
import { HubPostRelayService } from './posts/hub-post-relay.service';
import { HubPostsController } from './posts/hub-posts.controller';
import { HubPostsService } from './posts/hub-posts.service';
import { HubSessionNoteController } from './session-note/hub-session-note.controller';
import { HubSessionNoteService } from './session-note/hub-session-note.service';
import { CommunityHubKindAdapter } from './community/community-hub-kind.adapter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
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
  imports: [
    ActivityLogModule,
    ChannelMirrorModule,
    SettingsModule,
    HubWelcomeModule,
  ],
  // Order matters (ROK-1831): the literal `guilds/onboarding` and
  // `guilds/mine` must register before `guilds/:id`.
  controllers: [
    HubOnboardingController,
    HubMineController,
    HubController,
    HubNotificationMuteController,
    GuildDiscordController,
    HubPostsController,
    HubSessionNoteController,
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
    HubRenameService,
    HubVisibleGuard,
    HubWidgetPrefsService,
    HubEventTagger,
    HubPostRelayService,
    HubPostsService,
    HubSessionNoteService,
    CommunityHubKindAdapter,
  ],
  exports: [
    GuildAccessService,
    HubKindActiveGuard,
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
    private readonly hubKinds: HubKindRegistry,
  ) {}

  /** ROK-1831 Q2 / ROK-1969 D5: the Core plugin owns event tagging + `game_community`. */
  onModuleInit(): void {
    this.plugins.registerAdapter(
      EXTENSION_POINTS.EVENT_GUILD_TAGGER,
      EVENT_GUILD_TAGGER_KEY,
      this.tagger,
      { ownerPluginId: CORE_PLUGIN_ID },
    );
    // ROK-1870 A4: core owns `game_community`; Core is always active (ROK-1969 D3).
    this.plugins.registerAdapter(
      EXTENSION_POINTS.HUB_KIND,
      'game_community',
      this.communityHubs,
      { ownerPluginId: CORE_PLUGIN_ID },
    );
    // ROK-1428 Codex r17 P2: embeds + channel auto-link skip a hub kind whose
    // plugin is off (its URLs 403 via `HubKindRegistry.require`).
    setActiveHubKindsSource(() => this.hubKinds.active().map((a) => a.kind));
  }
}
