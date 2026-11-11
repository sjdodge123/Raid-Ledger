import { Injectable, Logger } from '@nestjs/common';
import { CharactersService } from '../../characters/characters.service';
import { BossDataRefreshService } from './boss-data-refresh.service';
import { WowItemMetaService } from './wowhead-item/wow-item-meta.service';
import { BlizzardRosterSyncJob } from './guilds/blizzard-roster-sync.job';
import { ForeverAutoLinkService } from './forever-auto-link/forever-auto-link.service';
import { RosterArmoryService } from './forever-armory-snapshot/roster-armory.service';
import { ForeverQuestAutoImportService } from './forever-quest-import/forever-quest-auto-import.service';
import type { CronRegistrar } from '../plugin-host/extension-points';
import type { CronJobDefinition } from '../plugin-host/extension-types';

/**
 * Registers cron jobs for WoW character auto-sync, boss data refresh, the
 * Forever guild roster sync (ROK-1928), the Forever Armory auto-link
 * (ROK-2124), the roster Armory pass (ROK-2133) and the weekly Forever quest
 * import refresh (ROK-2162). Only active when the
 * plugin is enabled. The Forever namespace probe (ROK-1716) is NOT scheduled:
 * it runs only from the admin "Run now" button (ROK-2163).
 * The auto-sync includes Armory-imported WoW: Forever rows (realm NULL,
 * ruleset set, game_variant set); manual Forever rows are skipped (ROK-1722).
 */
@Injectable()
export class WowCronRegistrar implements CronRegistrar {
  private readonly logger = new Logger(WowCronRegistrar.name);
  private isSyncing = false;

  constructor(
    private readonly charactersService: CharactersService,
    private readonly bossDataRefresh: BossDataRefreshService,
    private readonly itemMeta: WowItemMetaService,
    private readonly rosterSync: BlizzardRosterSyncJob,
    private readonly autoLink: ForeverAutoLinkService,
    private readonly rosterArmory: RosterArmoryService,
    private readonly questImport: ForeverQuestAutoImportService,
  ) {}

  getCronJobs(): CronJobDefinition[] {
    return [
      {
        name: 'character-auto-sync',
        cronExpression: '0 0 3,15 * * *',
        handler: () => this.handleAutoSync(),
      },
      {
        name: 'boss-data-refresh',
        // Every Sunday at 4:00 AM
        cronExpression: '0 0 4 * * 0',
        handler: () => this.handleBossDataRefresh(),
      },
      {
        name: 'wowhead-item-retry',
        // Daily at 5:15 AM — re-probe due Wowhead item rows (ROK-1727),
        // then backfill boss-loot tooltips (ROK-2176)
        cronExpression: '0 15 5 * * *',
        handler: () => this.handleWowheadItemRetry(),
      },
      {
        name: 'forever-guild-roster-sync',
        // Every 6h at :20 — Forever guild rosters from Blizzard (ROK-1928 C)
        cronExpression: '0 20 */6 * * *',
        handler: () => this.rosterSync.run().then(() => undefined),
      },
      ...this.foreverArmoryJobs(),
      {
        name: 'forever-quest-import',
        // Wednesdays at 06:30 server time (UTC in the container; no timeZone
        // is set on the job) — refresh Forever quest XP/money from
        // Blizzard (ROK-2162); skipped when a run is already in progress.
        cronExpression: '0 30 6 * * 3',
        handler: () => this.questImport.runWeekly(),
      },
    ];
  }

  /** The hourly Forever Armory jobs: auto-link (2124) + roster pass (2133). */
  private foreverArmoryJobs(): CronJobDefinition[] {
    return [
      {
        name: 'forever-armory-autolink',
        // Hourly at :40 — link LedgerLink Forever rows to the Armory (ROK-2124)
        cronExpression: '0 40 * * * *',
        handler: () => this.autoLink.runDue().then(() => undefined),
      },
      {
        name: 'forever-roster-armory',
        // Hourly at :50 — Armory snapshots of roster members (ROK-2133 D3)
        cronExpression: '0 50 * * * *',
        handler: () => this.rosterArmory.runDue().then(() => undefined),
      },
    ];
  }

  /** Due re-probes first, then the boss-loot tooltip backfill (ROK-2176). */
  private async handleWowheadItemRetry(): Promise<void> {
    await this.itemMeta.retryDue();
    await this.itemMeta.backfillBossLoot();
  }

  private async handleAutoSync(): Promise<void> {
    if (this.isSyncing) {
      this.logger.warn('Auto-sync already in progress, skipping');
      return;
    }

    this.isSyncing = true;
    this.logger.log('Starting auto-sync of Blizzard characters...');

    try {
      const result = await this.charactersService.syncAllCharacters();
      this.logger.log(
        `Auto-sync complete: ${result.synced} synced, ${result.failed} failed`,
      );
    } catch (err) {
      this.logger.error(`Auto-sync failed: ${err}`);
    } finally {
      this.isSyncing = false;
    }
  }

  private async handleBossDataRefresh(): Promise<void> {
    this.logger.log('Starting weekly boss data refresh...');
    try {
      const result = await this.bossDataRefresh.refresh();
      this.logger.log(
        `Boss data refresh complete: ${result.bosses} bosses, ${result.loot} loot items`,
      );
    } catch (err) {
      this.logger.error(`Boss data refresh failed: ${err}`);
    }
  }
}
