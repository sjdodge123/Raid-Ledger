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
import { findCreateCandidates } from './ephemeral-voice.db-helpers';

/**
 * Create-window scanner for ephemeral voice channels (ROK-1352).
 *
 * Mirrors the SE start-scan (`scheduled-event.service.ts:68`, `0 * * * * *`);
 * runs at the `:30` second offset so it never collides with that tick. Window
 * scans are naturally idempotent + reschedule-safe — a channel is only created
 * when start ∈ [now, now+buffer] AND ephemeral_voice_channel_id IS NULL.
 */
@Injectable()
export class EphemeralVoiceScheduler {
  private readonly logger = new Logger(EphemeralVoiceScheduler.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
    private readonly cronJobService: CronJobService,
    private readonly ephemeralVoice: EphemeralVoiceService,
  ) {}

  @Cron('30 * * * * *', {
    name: 'EphemeralVoiceScheduler_scanCreateWindow',
  })
  async handleScanCreateWindow(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'EphemeralVoiceScheduler_scanCreateWindow',
      () => this.scanCreateWindow(),
    );
  }

  /** Create ephemeral channels for gate-enabled events in the buffer window. */
  async scanCreateWindow(): Promise<void | false> {
    if (!this.clientService.isConnected()) return false;
    if (!(await this.settingsService.getEphemeralVoiceEnabled())) return false;
    const bufferMin =
      await this.settingsService.getEphemeralVoiceCreateBufferMinutes();
    try {
      const candidates = await findCreateCandidates(
        this.db,
        new Date(),
        bufferMin * 60_000,
      );
      for (const ev of candidates) {
        if (await this.ephemeralVoice.shouldCreate(ev)) {
          await this.ephemeralVoice.createForEvent(ev);
        }
      }
    } catch (err) {
      this.logger.error(
        `Ephemeral create-window scan failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      Sentry.captureException(err, {
        tags: { context: 'ephemeral-voice-scheduler' },
      });
    }
  }
}
