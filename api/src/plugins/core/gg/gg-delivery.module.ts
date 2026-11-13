import { Module, forwardRef } from '@nestjs/common';
import { CronJobModule } from '../../../cron-jobs/cron-job.module';
import { DiscordBotModule } from '../../../discord-bot/discord-bot.module';
import { NotificationModule } from '../../../notifications/notification.module';
import { SettingsModule } from '../../../settings/settings.module';
import { DemoTestGgController } from '../../../admin/demo-test-gg.controller';
import { GgAdminController } from './gg-admin.controller';
import { GgDeliveryCron } from './gg-delivery.cron';
import { GgDeliveryService } from './gg-delivery.service';
import { GgModule } from './gg.module';

/**
 * ROK-2187 — Core's GG <year> delivery: the 5-minute cron, the DM wave, the
 * admin tools and the DEMO_MODE fixture (`/admin/test/gg/*`).
 */
@Module({
  imports: [
    GgModule,
    SettingsModule,
    CronJobModule,
    forwardRef(() => NotificationModule),
    forwardRef(() => DiscordBotModule),
  ],
  controllers: [GgAdminController, DemoTestGgController],
  providers: [GgDeliveryService, GgDeliveryCron],
  exports: [GgDeliveryService],
})
export class GgDeliveryModule {}
