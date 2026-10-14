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
import { PelicanServersRepository } from './pelican-servers.repository';
import { PelicanServersAdminRepository } from './pelican-servers-admin.repository';
import { PelicanServersAdminController } from './pelican-servers-admin.controller';
import { PelicanSyncService } from './pelican-sync.service';
import { PelicanSchedulesRepository } from './pelican-schedules.repository';
import { PelicanScheduleSyncService } from './pelican-schedule-sync.service';
import { PelicanStatusService } from './pelican-status.service';
import { PelicanCronRegistrar } from './pelican-cron.registrar';
import { PelicanGameServerProvider } from './pelican-game-server.provider';
import { PelicanAdapterRegistration } from './pelican-adapters';
import { PelicanDemoSeedController } from './pelican-demo-seed.controller';

type UninstalledPayload = { slug: string };

/**
 * Pelican panel plugin (ROK-121). Registers its manifest only — no
 * `ensureInstalled`, so an uninstall survives a restart (Lead ruling Q1).
 */
@Module({
  imports: [SettingsModule],
  controllers: [
    PelicanAdminController,
    PelicanServersAdminController,
    // DEMO_MODE fixture (ROK-1094) — NOT plugin-gated: it installs + activates
    // the plugin itself, so it must answer while Pelican is inactive.
    PelicanDemoSeedController,
  ],
  providers: [
    PelicanConfigService,
    PelicanClientFactory,
    PelicanServersRepository,
    PelicanServersAdminRepository,
    PelicanSchedulesRepository,
    PelicanScheduleSyncService,
    PelicanSyncService,
    PelicanStatusService,
    PelicanCronRegistrar,
    PelicanGameServerProvider,
    PelicanAdapterRegistration,
  ],
  exports: [
    PelicanClientFactory,
    PelicanServersRepository,
    PelicanSchedulesRepository,
    PelicanSyncService,
    PelicanStatusService,
  ],
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
    private readonly servers: PelicanServersRepository,
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
   * Pelican key through the service so the cache drops it too. Then empty
   * `pelican_servers` (the FK cascade empties `pelican_schedules`) —
   * ROK-1772 D13. Errors are logged by name only.
   */
  async handleUninstalled(payload: UninstalledPayload): Promise<void> {
    if (payload.slug !== PELICAN_PLUGIN_ID) return;
    try {
      for (const key of PELICAN_SETTING_KEYS) await this.settings.delete(key);
    } catch (err) {
      this.logger.error(`Pelican settings eviction failed: ${errName(err)}`);
      this.settings.invalidateCache(true);
    }
    try {
      await this.servers.deleteAll();
    } catch (err) {
      this.logger.error(`Pelican server rows cleanup failed: ${errName(err)}`);
    }
  }
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown error';
}
