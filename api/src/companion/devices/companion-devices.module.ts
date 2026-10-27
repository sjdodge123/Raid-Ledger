import { Module } from '@nestjs/common';
import { CronJobModule } from '../../cron-jobs/cron-job.module';
import { SettingsModule } from '../../settings/settings.module';
import { CompanionDeviceLinkCleanupService } from './companion-device-link-cleanup.service';
import { CompanionDeviceLinkPollService } from './companion-device-link-poll.service';
import { CompanionDeviceLinkController } from './companion-device-link.controller';
import { CompanionDeviceRateLimiter } from './companion-device-link.limits';
import { CompanionDeviceLinkService } from './companion-device-link.service';
import { CompanionDeviceLinksRepository } from './companion-device-links.repository';
import { CompanionDeviceGuard } from './companion-device.guard';
import { CompanionDevicesController } from './companion-devices.controller';
import { CompanionDevicesRepository } from './companion-devices.repository';
import { CompanionDevicesService } from './companion-devices.service';

/**
 * ROK-1955: companion device tokens — the RFC 8628 link flow (L3), the
 * `rlcd_` device guard and the Devices API (L4).
 */
@Module({
  imports: [SettingsModule, CronJobModule],
  controllers: [CompanionDeviceLinkController, CompanionDevicesController],
  providers: [
    CompanionDeviceLinksRepository,
    CompanionDeviceLinkService,
    CompanionDeviceLinkPollService,
    CompanionDeviceRateLimiter,
    CompanionDeviceLinkCleanupService,
    CompanionDevicesRepository,
    CompanionDevicesService,
    CompanionDeviceGuard,
  ],
  // C3's ingest routes reuse the guard (and its repository + limiter).
  exports: [
    CompanionDeviceRateLimiter,
    CompanionDevicesRepository,
    CompanionDeviceGuard,
  ],
})
export class CompanionDevicesModule {}
