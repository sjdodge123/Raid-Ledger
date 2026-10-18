import { Module } from '@nestjs/common';
import { ChannelMirrorModule } from '../discord-bot/channel-mirror/channel-mirror.module';
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

/**
 * ROK-1830 S2a: the game-agnostic guild hub core — access/ladder, editors,
 * profile and the Discord mirror. Game plugins import it and register their
 * hub kind under `EXTENSION_POINTS.HUB_KIND`. Routes keep their
 * `/plugins/wow/guilds/**` paths (spec Q2) until a second kind exists.
 */
@Module({
  imports: [ChannelMirrorModule],
  controllers: [GuildDiscordController, HubOnboardingController],
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
  ],
  exports: [
    GuildAccessService,
    GuildEditorGuard,
    GuildLeaderGuard,
    GuildEditorsService,
    GuildProfileService,
    HubKindRegistry,
    HubOnboardingService,
  ],
})
export class GuildsCoreModule {}
