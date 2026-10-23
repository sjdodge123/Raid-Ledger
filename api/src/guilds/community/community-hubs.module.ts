import { Module } from '@nestjs/common';
import { DiscordBotModule } from '../../discord-bot/discord-bot.module';
import { SettingsModule } from '../../settings/settings.module';
import { GuildsCoreModule } from '../guilds-core.module';
import { CommunityDirectoryService } from './community-directory.service';
import { CommunityHubsController } from './community-hubs.controller';
import { CommunityMembershipService } from './community-membership.service';
import { CommunityModerationService } from './community-moderation.service';
import { HubDiscordInviteService } from './invites/hub-discord-invite.service';
import { HubInviteLandingService } from './invites/hub-invite-landing.service';
import { HubInvitesController } from './invites/hub-invites.controller';
import { HubInvitesService } from './invites/hub-invites.service';
import { HubAutoMembershipController } from './hub-auto-membership.controller';
import { HubAutoMembershipService } from './hub-auto-membership.service';

/**
 * ROK-1870 L3 — the `hubs` directory + membership routes. Imported in
 * `AppModule` AFTER `CommunityProposalsModule` so `hubs/proposals` wins.
 */
@Module({
  imports: [GuildsCoreModule, SettingsModule, DiscordBotModule],
  // ROK-1893: HubInvitesController first — its literal `hubs/invites/…` wins.
  controllers: [
    HubInvitesController,
    CommunityHubsController,
    HubAutoMembershipController,
  ],
  providers: [
    CommunityDirectoryService,
    CommunityMembershipService,
    CommunityModerationService,
    HubAutoMembershipService,
    HubDiscordInviteService,
    HubInviteLandingService,
    HubInvitesService,
  ],
})
export class CommunityHubsModule {}
