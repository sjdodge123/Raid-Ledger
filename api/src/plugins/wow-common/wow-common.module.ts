import { Module, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { bestEffortInit } from '../../common/lifecycle.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BlizzardService } from './blizzard.service';
import { BlizzardAuthService } from './blizzard-auth.service';
import { BlizzardController } from './blizzard.controller';
import { BlizzardCharacterSyncAdapter } from './blizzard-character-sync.adapter';
import { BlizzardContentProvider } from './blizzard-content.provider';
import { WowCronRegistrar } from './wow-cron-registrar';
import { DungeonQuestsController } from './dungeon-quests.controller';
import { DungeonQuestsService } from './dungeon-quests.service';
import { DungeonQuestSeeder } from './dungeon-quest-seeder';
import { BossEncountersController } from './boss-encounters.controller';
import { BossEncountersService } from './boss-encounters.service';
import { BossEncounterSeeder } from './boss-encounter-seeder';
import { BossDataRefreshService } from './boss-data-refresh.service';
import { QuestProgressController } from './quest-progress.controller';
import { QuestProgressService } from './quest-progress.service';
import { SettingsModule } from '../../settings/settings.module';
import { CharactersModule } from '../../characters/characters.module';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { EXTENSION_POINTS } from '../plugin-host/extension-points';
import { PLUGIN_EVENTS } from '../plugin-host/plugin-manifest.interface';
import { WOW_COMMON_MANIFEST } from './manifest';

@Module({
  imports: [SettingsModule, CharactersModule],
  controllers: [
    BlizzardController,
    DungeonQuestsController,
    BossEncountersController,
    QuestProgressController,
  ],
  providers: [
    BlizzardService,
    BlizzardAuthService,
    BlizzardCharacterSyncAdapter,
    BlizzardContentProvider,
    WowCronRegistrar,
    DungeonQuestsService,
    DungeonQuestSeeder,
    BossEncountersService,
    BossEncounterSeeder,
    BossDataRefreshService,
    QuestProgressService,
  ],
  exports: [
    BlizzardService,
    BlizzardCharacterSyncAdapter,
    BlizzardContentProvider,
    DungeonQuestsService,
    BossEncountersService,
  ],
})
export class WowCommonModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WowCommonModule.name);
  private activatedHandler?: (payload: { slug: string }) => void;
  private installedHandler?: (payload: { slug: string }) => void;
  private uninstalledHandler?: (payload: { slug: string }) => void;

  constructor(
    private readonly pluginRegistry: PluginRegistryService,
    private readonly eventEmitter: EventEmitter2,
    private readonly characterSyncAdapter: BlizzardCharacterSyncAdapter,
    private readonly contentProvider: BlizzardContentProvider,
    private readonly cronRegistrar: WowCronRegistrar,
    private readonly dungeonQuestsService: DungeonQuestsService,
    private readonly bossEncountersService: BossEncountersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await bestEffortInit('WowCommonModule.init', this.logger, async () => {
      this.pluginRegistry.registerManifest(WOW_COMMON_MANIFEST);
      await this.pluginRegistry.ensureInstalled(WOW_COMMON_MANIFEST.id);
      this.registerAdapters();
      await this.seedOnBoot();
      this.registerEventHandlers();
    });
  }

  /** Seed data on first boot (non-fatal on failure). */
  private async seedOnBoot(): Promise<void> {
    await this.safeSeed('Dungeon quest', () =>
      this.dungeonQuestsService.seedQuests(),
    );
    await this.safeSeed('Boss encounter', () =>
      this.bossEncountersService.seedBosses(),
    );
  }

  /** Run a seed function with error handling for missing tables. */
  private async safeSeed(
    label: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const msg = String(err);
      if (msg.includes('relation') && msg.includes('does not exist')) {
        this.logger.error(
          `${label} seed FAILED — table does not exist. Migrations may not have run: ${err}`,
        );
      } else {
        this.logger.warn(`${label} seed skipped (may already exist): ${err}`);
      }
    }
  }

  /** Handle plugin install: register adapters + seed data. */
  private handleInstalled(payload: { slug: string }): void {
    if (payload.slug !== WOW_COMMON_MANIFEST.id) return;
    this.registerAdapters();
    this.dungeonQuestsService
      .seedQuests()
      .catch((err) =>
        this.logger.error(`Failed to seed dungeon quests on install: ${err}`),
      );
    this.bossEncountersService
      .seedBosses()
      .catch((err) =>
        this.logger.error(`Failed to seed boss encounters on install: ${err}`),
      );
  }

  /** Handle plugin uninstall: drop seed data. */
  private handleUninstalled(payload: { slug: string }): void {
    if (payload.slug !== WOW_COMMON_MANIFEST.id) return;
    this.dungeonQuestsService
      .dropQuests()
      .catch((err) =>
        this.logger.error(`Failed to drop dungeon quests on uninstall: ${err}`),
      );
    this.bossEncountersService
      .dropBosses()
      .catch((err) =>
        this.logger.error(
          `Failed to drop boss encounters on uninstall: ${err}`,
        ),
      );
  }

  /** Register event handlers for plugin lifecycle events. */
  private registerEventHandlers(): void {
    this.activatedHandler = (payload) => {
      if (payload.slug === WOW_COMMON_MANIFEST.id) this.registerAdapters();
    };
    this.installedHandler = (payload) => this.handleInstalled(payload);
    this.uninstalledHandler = (payload) => this.handleUninstalled(payload);
    this.eventEmitter.on(PLUGIN_EVENTS.ACTIVATED, this.activatedHandler);
    this.eventEmitter.on(PLUGIN_EVENTS.INSTALLED, this.installedHandler);
    this.eventEmitter.on(PLUGIN_EVENTS.UNINSTALLED, this.uninstalledHandler);
  }

  onModuleDestroy(): void {
    if (this.activatedHandler) {
      this.eventEmitter.removeListener(
        PLUGIN_EVENTS.ACTIVATED,
        this.activatedHandler,
      );
    }
    if (this.installedHandler) {
      this.eventEmitter.removeListener(
        PLUGIN_EVENTS.INSTALLED,
        this.installedHandler,
      );
    }
    if (this.uninstalledHandler) {
      this.eventEmitter.removeListener(
        PLUGIN_EVENTS.UNINSTALLED,
        this.uninstalledHandler,
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
