import { Module } from '@nestjs/common';
import { CronJobModule } from '../../cron-jobs/cron-job.module';
import { SettingsModule } from '../../settings/settings.module';
import { CompanionDeviceLinkCleanupService } from './companion-device-link-cleanup.service';
import { CompanionDeviceLinkPollService } from './companion-device-link-poll.service';
import { CompanionDeviceLinkController } from './companion-device-link.controller';
import { CompanionDeviceRateLimiter } from './companion-device-link.limits';
import { CompanionDeviceLinkService } from './companion-device-link.service';
import { CompanionDeviceLinksRepository } from './companion-device-links.repository';

/**
 * ROK-1955: companion device tokens — the RFC 8628 link flow (L3). The
 * device guard and the Devices API (L4) register here too.
 */
@Module({
  imports: [SettingsModule, CronJobModule],
  controllers: [CompanionDeviceLinkController],
  providers: [
    CompanionDeviceLinksRepository,
    CompanionDeviceLinkService,
    CompanionDeviceLinkPollService,
    CompanionDeviceRateLimiter,
    CompanionDeviceLinkCleanupService,
  ],
  exports: [CompanionDeviceRateLimiter],
})
export class CompanionDevicesModule {}
