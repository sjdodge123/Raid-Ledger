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
import {
  findCreateCandidates,
  findNameReconcileCandidates,
} from './ephemeral-voice.db-helpers';

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

  @Cron('45 * * * * *', {
    name: 'EphemeralVoiceScheduler_scanNameReconcile',
  })
  async handleScanNameReconcile(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'EphemeralVoiceScheduler_scanNameReconcile',
      () => this.scanNameReconcile(),
    );
  }

  /**
   * Backfill / self-heal Discord display names for in-flight ephemeral events.
   * On the first post-deploy tick this renames existing channels + SEs to the
   * current scheme (drop redundant "Event", add the start-time suffix); once they
   * match it is a no-op (the service compares before renaming, so no rename-churn
   * against Discord's ~2/10min channel-rename limit). Separate from the
   * create-window scan; mirrors the reaper in gating only on connectivity so
   * existing channels are reconciled regardless of the global toggle.
   */
  async scanNameReconcile(): Promise<void | false> {
    if (!this.clientService.isConnected()) return false;
    try {
      const candidates = await findNameReconcileCandidates(this.db, new Date());
      for (const ev of candidates) {
        await this.ephemeralVoice.reconcileNamesForEvent(ev);
      }
    } catch (err) {
      this.logger.error(
        `Ephemeral name-reconcile scan failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      Sentry.captureException(err, {
        tags: { context: 'ephemeral-voice-scheduler' },
      });
    }
  }
}
