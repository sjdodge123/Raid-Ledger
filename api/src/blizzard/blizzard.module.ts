import { Module, OnModuleInit } from '@nestjs/common';
import { BlizzardService } from './blizzard.service';
import { BlizzardController } from './blizzard.controller';
import { BlizzardCharacterSyncAdapter } from './blizzard-character-sync.adapter';
import { BlizzardContentProvider } from './blizzard-content.provider';
import { SettingsModule } from '../settings/settings.module';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';

@Module({
  imports: [SettingsModule],
  controllers: [BlizzardController],
  providers: [
    BlizzardService,
    BlizzardCharacterSyncAdapter,
    BlizzardContentProvider,
  ],
  exports: [
    BlizzardService,
    BlizzardCharacterSyncAdapter,
    BlizzardContentProvider,
  ],
})
export class BlizzardModule implements OnModuleInit {
  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly characterSyncAdapter: BlizzardCharacterSyncAdapter,
    private readonly contentProvider: BlizzardContentProvider,
  ) {}

  onModuleInit(): void {
    for (const slug of this.characterSyncAdapter.gameSlugs) {
      this.pluginRegistry.registerAdapter(
        EXTENSION_POINTS.CHARACTER_SYNC,
        slug,
        this.characterSyncAdapter,
      );
    }

    for (const slug of this.contentProvider.gameSlugs) {
      this.pluginRegistry.registerAdapter(
        EXTENSION_POINTS.CONTENT_PROVIDER,
        slug,
        this.contentProvider,
      );
    }
  }
}
