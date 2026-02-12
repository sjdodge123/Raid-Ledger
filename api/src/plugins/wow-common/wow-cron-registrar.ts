import { Injectable, Logger } from '@nestjs/common';
import { CharactersService } from '../../characters/characters.service';
import type { CronRegistrar } from '../plugin-host/extension-points';
import type { CronJobDefinition } from '../plugin-host/extension-types';

/**
 * Registers cron jobs for WoW character auto-sync.
 * Only active when the wow-common plugin is enabled.
 */
@Injectable()
export class WowCronRegistrar implements CronRegistrar {
  private readonly logger = new Logger(WowCronRegistrar.name);
  private isSyncing = false;

  constructor(private readonly charactersService: CharactersService) {}

  getCronJobs(): CronJobDefinition[] {
    return [
      {
        name: 'character-auto-sync',
        cronExpression: '0 0 3,15 * * *',
        handler: () => this.handleAutoSync(),
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
}
