import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CharactersService } from './characters.service';

/**
 * Cron service that auto-syncs all externally-linked characters every 12 hours.
 * Fires at 03:00 and 15:00 UTC.
 */
@Injectable()
export class CharacterSyncService {
  private readonly logger = new Logger(CharacterSyncService.name);
  private isSyncing = false;

  constructor(private readonly charactersService: CharactersService) {}

  @Cron('0 0 3,15 * * *')
  async handleAutoSync() {
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
