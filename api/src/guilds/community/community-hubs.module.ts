import { Module } from '@nestjs/common';
import { GuildsCoreModule } from '../guilds-core.module';
import { CommunityDirectoryService } from './community-directory.service';
import { CommunityHubsController } from './community-hubs.controller';
import { CommunityMembershipService } from './community-membership.service';
import { CommunityModerationService } from './community-moderation.service';
import { HubAutoMembershipController } from './hub-auto-membership.controller';
import { HubAutoMembershipService } from './hub-auto-membership.service';

/**
 * ROK-1870 L3 — the `hubs` directory + membership routes. Imported in
 * `AppModule` AFTER `CommunityProposalsModule` so `hubs/proposals` wins.
 */
@Module({
  imports: [GuildsCoreModule],
  controllers: [CommunityHubsController, HubAutoMembershipController],
  providers: [
    CommunityDirectoryService,
    CommunityMembershipService,
    CommunityModerationService,
    HubAutoMembershipService,
  ],
})
export class CommunityHubsModule {}
