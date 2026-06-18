import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { EphemeralVoiceService } from './ephemeral-voice.service';
import { findReapCandidates } from './ephemeral-voice.db-helpers';

/**
 * Safety-net reaper for ephemeral voice channels (ROK-1352).
 *
 * Mirrors `ad-hoc-reaper.service.ts` (every 5 minutes). Deletes any ephemeral
 * channel whose event ended more than `idleMinutes` ago AND is currently empty.
 * Reconciles orphans left by a missed voice-leave event or a restart. The
 * service re-checks occupancy before delete — never deletes while occupied.
 */
@Injectable()
export class EphemeralVoiceReaper {
  private readonly logger = new Logger(EphemeralVoiceReaper.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
    private readonly ephemeralVoice: EphemeralVoiceService,
  ) {}

  @Cron('0 */5 * * * *', {
    name: 'EphemeralVoiceReaper_reapIdle',
    waitForCompletion: true,
  })
  async handleReapIdle(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'EphemeralVoiceReaper_reapIdle',
      () => this.reapIdle(),
    );
  }

  /** Delete empty ephemeral channels whose event ended > idle window ago. */
  async reapIdle(): Promise<void | false> {
    if (!this.clientService.isConnected()) return false;
    const idleMin = await this.settingsService.getEphemeralVoiceIdleMinutes();
    try {
      const candidates = await findReapCandidates(
        this.db,
        new Date(),
        idleMin * 60_000,
      );
      for (const ev of candidates) {
        await this.ephemeralVoice.destroyForEvent(ev);
      }
    } catch (err) {
      this.logger.error(
        `Ephemeral reaper scan failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      Sentry.captureException(err, {
        tags: { context: 'ephemeral-voice-reaper' },
      });
    }
  }
}
