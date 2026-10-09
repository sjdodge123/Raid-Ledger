import { Injectable, Logger } from '@nestjs/common';
import { CharactersService } from '../../characters/characters.service';
import { BossDataRefreshService } from './boss-data-refresh.service';
import { ForeverNamespaceProbeService } from './forever-namespace-probe.service';
import { WowItemMetaService } from './wowhead-item/wow-item-meta.service';
import type { CronRegistrar } from '../plugin-host/extension-points';
import type { CronJobDefinition } from '../plugin-host/extension-types';
import type { ForeverProbeResultDto } from '@raid-ledger/contract';

/**
 * Registers cron jobs for WoW character auto-sync, boss data refresh and the
 * Forever namespace probe (ROK-1716). Only active when the plugin is enabled.
 */
@Injectable()
export class WowCronRegistrar implements CronRegistrar {
  private readonly logger = new Logger(WowCronRegistrar.name);
  private isSyncing = false;

  constructor(
    private readonly charactersService: CharactersService,
    private readonly bossDataRefresh: BossDataRefreshService,
    private readonly foreverProbe: ForeverNamespaceProbeService,
    private readonly itemMeta: WowItemMetaService,
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
        name: 'forever-namespace-probe',
        // Daily at 5:00 AM (ROK-1716 D7)
        cronExpression: '0 0 5 * * *',
        handler: async () => throwOnProbeError(await this.foreverProbe.run()),
      },
      {
        name: 'forever-namespace-probe-launch',
        // Hourly at :30; the service no-ops outside the launch window (D7)
        cronExpression: '0 30 * * * *',
        handler: async () =>
          throwOnProbeError(await this.foreverProbe.runIfInLaunchWindow()),
      },
      {
        name: 'wowhead-item-retry',
        // Daily at 5:15 AM — re-probe due Wowhead item rows (ROK-1727)
        cronExpression: '0 15 5 * * *',
        handler: () => this.itemMeta.retryDue().then(() => undefined),
      },
    ];
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

/**
 * Fail the cron run (so the admin cron table shows it) when the probe errored.
 * `skipped` (no Blizzard creds) and null (outside the launch window) succeed.
 */
function throwOnProbeError(result: ForeverProbeResultDto | null): void {
  if (result?.status === 'error') {
    throw new Error('Forever namespace probe failed (see API logs)');
  }
}
