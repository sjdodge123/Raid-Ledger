import { Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsModule } from '../../settings/settings.module';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PLUGIN_EVENTS } from '../plugin-host/plugin-manifest.interface';
import { PELICAN_PLUGIN_ID } from './pelican.constants';
import { PELICAN_MANIFEST, PELICAN_SETTING_KEYS } from './pelican.manifest';
import { PelicanAdminController } from './pelican-admin.controller';
import { PelicanConfigService } from './pelican-config.service';
import { PelicanClientFactory } from './pelican-client.factory';

type UninstalledPayload = { slug: string };

/**
 * Pelican panel plugin (ROK-121). Registers its manifest only — no
 * `ensureInstalled`, so an uninstall survives a restart (Lead ruling Q1).
 */
@Module({
  imports: [SettingsModule],
  controllers: [PelicanAdminController],
  providers: [PelicanConfigService, PelicanClientFactory],
  exports: [PelicanClientFactory],
})
export class PelicanModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PelicanModule.name);
  private readonly uninstalledHandler = (payload: UninstalledPayload): void => {
    void this.handleUninstalled(payload);
  };

  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.pluginRegistry.registerManifest(PELICAN_MANIFEST);
    this.eventEmitter.on(PLUGIN_EVENTS.UNINSTALLED, this.uninstalledHandler);
  }

  onModuleDestroy(): void {
    this.eventEmitter.removeListener(
      PLUGIN_EVENTS.UNINSTALLED,
      this.uninstalledHandler,
    );
  }

  /**
   * Uninstall deletes the rows with raw SQL (`cleanupPluginSettings`), which
   * leaves `SettingsService`'s cache serving the decrypted key. Evict each
   * Pelican key through the service so the cache drops it too (D13).
   */
  async handleUninstalled(payload: UninstalledPayload): Promise<void> {
    if (payload.slug !== PELICAN_PLUGIN_ID) return;
    try {
      for (const key of PELICAN_SETTING_KEYS) await this.settings.delete(key);
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'unknown error';
      this.logger.error(`Pelican settings eviction failed: ${reason}`);
      this.settings.invalidateCache(true);
    }
  }
}
