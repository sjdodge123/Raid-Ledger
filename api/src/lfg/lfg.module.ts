/**
 * LFG intents module (ROK-1451) — "I want to play this game".
 */
import { Module, forwardRef } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationModule } from '../notifications/notification.module';
import { LfgController } from './lfg.controller';
import { LfgBridgeController } from './lfg-bridge.controller';
import { LfgService } from './lfg.service';
import { LfgReadsService } from './lfg-reads.service';
import { LfgSignupListener } from './lfg-signup.listener';
import { LfgExpiryService } from './lfg-expiry.service';
import { LfgQuickPlayListener } from './lfg-quickplay.listener';
import { LfgInviteService } from './lfg-invite.service';

@Module({
  imports: [
    DrizzleModule,
    CronJobModule,
    SettingsModule,
    // ROK-1455 D9: the invite DM reuses NotificationService.create. Notification
    // -> DiscordBot -> Lfg already closes a cycle on a forwardRef edge, so this
    // edge must be one too or Nest fails at boot, not at compile time.
    forwardRef(() => NotificationModule),
  ],
  controllers: [LfgBridgeController, LfgController],
  providers: [
    LfgService,
    LfgReadsService,
    LfgSignupListener,
    LfgQuickPlayListener,
    LfgExpiryService,
    LfgInviteService,
  ],
  exports: [LfgService, LfgReadsService, LfgInviteService],
})
export class LfgModule {}
