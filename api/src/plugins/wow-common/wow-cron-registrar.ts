import { Injectable, Logger } from '@nestjs/common';
import { CharactersService } from '../../characters/characters.service';
import { BossDataRefreshService } from './boss-data-refresh.service';
import type { CronRegistrar } from '../plugin-host/extension-points';
import type { CronJobDefinition } from '../plugin-host/extension-types';

/**
 * Registers cron jobs for WoW character auto-sync and boss data refresh.
 * Only active when the wow-common plugin is enabled.
 */
@Injectable()
export class WowCronRegistrar implements CronRegistrar {
  private readonly logger = new Logger(WowCronRegistrar.name);
  private isSyncing = false;

  constructor(
    private readonly charactersService: CharactersService,
    private readonly bossDataRefresh: BossDataRefreshService,
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
