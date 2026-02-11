import { Global, Module } from '@nestjs/common';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginActiveGuard } from './plugin-active.guard';
import { PluginAdminController } from './plugin-admin.controller';

@Global()
@Module({
  controllers: [PluginAdminController],
  providers: [PluginRegistryService, PluginActiveGuard],
  exports: [PluginRegistryService, PluginActiveGuard],
})
export class PluginHostModule {}
