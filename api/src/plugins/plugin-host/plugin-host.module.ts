import { Global, Module } from '@nestjs/common';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginActiveGuard } from './plugin-active.guard';
import { PluginAdminController } from './plugin-admin.controller';
import { CronManagerService } from './cron-manager.service';
import { GameServerCalendarController } from './game-server-calendar.controller';
import { GameServerCalendarService } from './game-server-calendar.service';

@Global()
@Module({
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
