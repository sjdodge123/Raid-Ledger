import { Global, Module } from '@nestjs/common';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginActiveGuard } from './plugin-active.guard';
import { PluginAdminController } from './plugin-admin.controller';
import { CronManagerService } from './cron-manager.service';
import { GameServerCalendarController } from './game-server-calendar.controller';
import { GameServerCalendarService } from './game-server-calendar.service';
import { CronJobModule } from '../../cron-jobs/cron-job.module';

@Global()
@Module({
  // CronManagerService routes scheduled plugin ticks through
  // CronJobService.executeWithTracking (pause + run history, ROK-2166).
  imports: [CronJobModule],
  controllers: [PluginAdminController, GameServerCalendarController],
  providers: [
    PluginRegistryService,
    PluginActiveGuard,
    CronManagerService,
    GameServerCalendarService,
  ],
  exports: [PluginRegistryService, PluginActiveGuard, CronManagerService],
})
export class PluginHostModule {}
