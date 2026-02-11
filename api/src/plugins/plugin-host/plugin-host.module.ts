import { Global, Module } from '@nestjs/common';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginActiveGuard } from './plugin-active.guard';
import { PluginAdminController } from './plugin-admin.controller';
import { CronManagerService } from './cron-manager.service';

@Global()
@Module({
  controllers: [PluginAdminController],
  providers: [PluginRegistryService, PluginActiveGuard, CronManagerService],
  exports: [PluginRegistryService, PluginActiveGuard, CronManagerService],
})
export class PluginHostModule {}
