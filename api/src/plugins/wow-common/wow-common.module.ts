import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BlizzardService } from './blizzard.service';
import { BlizzardController } from './blizzard.controller';
import { BlizzardCharacterSyncAdapter } from './blizzard-character-sync.adapter';
import { BlizzardContentProvider } from './blizzard-content.provider';
import { WowCronRegistrar } from './wow-cron-registrar';
import { SettingsModule } from '../../settings/settings.module';
import { CharactersModule } from '../../characters/characters.module';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { EXTENSION_POINTS } from '../plugin-host/extension-points';
import { PLUGIN_EVENTS } from '../plugin-host/plugin-manifest.interface';
import { WOW_COMMON_MANIFEST } from './manifest';

@Module({
  imports: [SettingsModule, CharactersModule],
  controllers: [BlizzardController],
  providers: [
    BlizzardService,
    BlizzardCharacterSyncAdapter,
    BlizzardContentProvider,
    WowCronRegistrar,
  ],
  exports: [
    BlizzardService,
    BlizzardCharacterSyncAdapter,
    BlizzardContentProvider,
  ],
})
export class WowCommonModule implements OnModuleInit, OnModuleDestroy {
  private activatedHandler?: (payload: { slug: string }) => void;

  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly eventEmitter: EventEmitter2,
    private readonly characterSyncAdapter: BlizzardCharacterSyncAdapter,
    private readonly contentProvider: BlizzardContentProvider,
    private readonly cronRegistrar: WowCronRegistrar,
  ) {}

  async onModuleInit(): Promise<void> {
    this.pluginRegistry.registerManifest(WOW_COMMON_MANIFEST);
    await this.pluginRegistry.ensureInstalled(WOW_COMMON_MANIFEST.id);
    this.registerAdapters();

    this.activatedHandler = (payload: { slug: string }) => {
      if (payload.slug === WOW_COMMON_MANIFEST.id) {
        this.registerAdapters();
      }
    };
    this.eventEmitter.on(PLUGIN_EVENTS.ACTIVATED, this.activatedHandler);
  }

  onModuleDestroy(): void {
    if (this.activatedHandler) {
      this.eventEmitter.removeListener(
        PLUGIN_EVENTS.ACTIVATED,
        this.activatedHandler,
      );
    }
  }

  private registerAdapters(): void {
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

    this.pluginRegistry.registerAdapter(
      EXTENSION_POINTS.CRON_REGISTRAR,
      WOW_COMMON_MANIFEST.id,
      this.cronRegistrar,
    );
  }
}
