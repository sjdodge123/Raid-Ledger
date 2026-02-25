import { Module, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BlizzardService } from './blizzard.service';
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
    this.pluginRegistry.registerManifest(WOW_COMMON_MANIFEST);
    await this.pluginRegistry.ensureInstalled(WOW_COMMON_MANIFEST.id);
    this.registerAdapters();

    // Seed dungeon quests on first boot
    try {
      await this.dungeonQuestsService.seedQuests();
    } catch (err) {
      const msg = String(err);
      if (msg.includes('relation') && msg.includes('does not exist')) {
        this.logger.error(
          `Dungeon quest seed FAILED — table does not exist. Migrations may not have run: ${err}`,
        );
      } else {
        this.logger.warn(
          `Dungeon quest seed skipped (may already exist): ${err}`,
        );
      }
    }

    // Seed boss encounters on first boot
    try {
      await this.bossEncountersService.seedBosses();
    } catch (err) {
      const msg = String(err);
      if (msg.includes('relation') && msg.includes('does not exist')) {
        this.logger.error(
          `Boss encounter seed FAILED — table does not exist. Migrations may not have run: ${err}`,
        );
      } else {
        this.logger.warn(
          `Boss encounter seed skipped (may already exist): ${err}`,
        );
      }
    }

    const reRegister = (payload: { slug: string }) => {
      if (payload.slug === WOW_COMMON_MANIFEST.id) {
        this.registerAdapters();
      }
    };

    const handleInstall = (payload: { slug: string }) => {
      if (payload.slug === WOW_COMMON_MANIFEST.id) {
        this.registerAdapters();
        this.dungeonQuestsService
          .seedQuests()
          .catch((err) =>
            this.logger.error(
              `Failed to seed dungeon quests on install: ${err}`,
            ),
          );
        this.bossEncountersService
          .seedBosses()
          .catch((err) =>
            this.logger.error(
              `Failed to seed boss encounters on install: ${err}`,
            ),
          );
      }
    };

    const handleUninstall = (payload: { slug: string }) => {
      if (payload.slug === WOW_COMMON_MANIFEST.id) {
        this.dungeonQuestsService
          .dropQuests()
          .catch((err) =>
            this.logger.error(
              `Failed to drop dungeon quests on uninstall: ${err}`,
            ),
          );
        this.bossEncountersService
          .dropBosses()
          .catch((err) =>
            this.logger.error(
              `Failed to drop boss encounters on uninstall: ${err}`,
            ),
          );
      }
    };

    this.activatedHandler = reRegister;
    this.installedHandler = handleInstall;
    this.uninstalledHandler = handleUninstall;
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
