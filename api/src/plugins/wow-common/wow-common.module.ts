import { Module, OnModuleInit } from '@nestjs/common';
import { BlizzardService } from './blizzard.service';
import { BlizzardController } from './blizzard.controller';
import { BlizzardCharacterSyncAdapter } from './blizzard-character-sync.adapter';
import { BlizzardContentProvider } from './blizzard-content.provider';
import { SettingsModule } from '../../settings/settings.module';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { EXTENSION_POINTS } from '../plugin-host/extension-points';
import { WOW_COMMON_MANIFEST } from './manifest';

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
export class WowCommonModule implements OnModuleInit {
  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly characterSyncAdapter: BlizzardCharacterSyncAdapter,
    private readonly contentProvider: BlizzardContentProvider,
  ) {}

  onModuleInit(): void {
    this.pluginRegistry.registerManifest(WOW_COMMON_MANIFEST);

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
