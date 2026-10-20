import { Module } from '@nestjs/common';
import { GuildsCoreModule } from '../guilds-core.module';
import { CommunityDirectoryService } from './community-directory.service';
import { CommunityHubsController } from './community-hubs.controller';
import { CommunityMembershipService } from './community-membership.service';
import { CommunityModerationService } from './community-moderation.service';

/**
 * ROK-1870 L3 — the `hubs` directory + membership routes. Imported in
 * `AppModule` AFTER `CommunityProposalsModule` so `hubs/proposals` wins.
 */
@Module({
  imports: [GuildsCoreModule],
  controllers: [CommunityHubsController],
  providers: [
    CommunityDirectoryService,
    CommunityMembershipService,
    CommunityModerationService,
  ],
})
export class CommunityHubsModule {}
