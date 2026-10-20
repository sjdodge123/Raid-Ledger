import { Module } from '@nestjs/common';
import { AdminHubsController } from '../../admin/admin-hubs.controller';
import { NotificationModule } from '../../notifications/notification.module';
import { CommunityProposalsController } from './community-proposals.controller';
import { CommunityProposalsService } from './community-proposals.service';

/**
 * ROK-1870 L2b — community hub proposals + Admin → Hubs. Imported in
 * `AppModule` BEFORE the L3 hubs module so `hubs/proposals` wins over
 * `hubs/:id`.
 */
@Module({
  imports: [NotificationModule],
  controllers: [CommunityProposalsController, AdminHubsController],
  providers: [CommunityProposalsService],
  exports: [CommunityProposalsService],
})
export class CommunityProposalsModule {}
