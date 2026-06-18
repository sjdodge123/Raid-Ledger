import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { ScheduledEventService } from './scheduled-event.service';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { VoiceAttendanceService } from './voice-attendance.service';
import { buildScheduledEventName } from './scheduled-event.helpers';
import {
  shouldCreateEphemeralChannel,
  fetchSeriesEphemeralEnabled,
} from './ephemeral-voice.gate.helpers';
import {
  createVoiceChannel,
  deleteVoiceChannel,
  getChannelMemberCount,
} from './ephemeral-voice.discord-ops';
import {
  type EphemeralEventRow,
  buildRepointData,
  setEphemeralChannelId,
  clearEphemeralChannelId,
  fetchEventForEphemeral,
} from './ephemeral-voice.db-helpers';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

/**
 * Lifecycle orchestration for ephemeral voice channels (ROK-1352).
 *
 * Create (buffer window): create the Discord channel under the configured
 * category, PERSIST the id BEFORE re-pointing the SE (architect constraint #1 —
 * the 15-min reconcile cron must read a non-null channel), then re-sync embeds.
 * Destroy: re-check occupancy, flush attendance, delete, clear the id, re-point
 * the SE back to the static fallback. All Discord calls are Sentry-instrumented.
 */
@Injectable()
export class EphemeralVoiceService {
  private readonly logger = new Logger(EphemeralVoiceService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
    private readonly scheduledEventService: ScheduledEventService,
    @Optional()
    @Inject(EmbedSyncQueueService)
    private readonly embedSyncQueue: EmbedSyncQueueService | null,
    @Optional()
    @Inject(VoiceAttendanceService)
    private readonly voiceAttendance: VoiceAttendanceService | null,
  ) {}

  /** Resolve the effective gate for an event (global → override → series). */
  async shouldCreate(ev: EphemeralEventRow): Promise<boolean> {
    const globalEnabled = await this.settingsService.getEphemeralVoiceEnabled();
    if (!globalEnabled) return false;
    const seriesEnabled = await fetchSeriesEphemeralEnabled(
      this.db,
      ev.recurrenceGroupId,
    );
    return shouldCreateEphemeralChannel(
      globalEnabled,
      ev.ephemeralVoiceEnabled,
      seriesEnabled,
    );
  }

  /**
   * Create the ephemeral channel for an event, persist the id, then re-point
   * the SE + re-sync the embed. Idempotent: no-op when one already exists.
   */
  async createForEvent(ev: EphemeralEventRow): Promise<void> {
    if (ev.ephemeralVoiceChannelId) return;
    const guild = this.requireGuild();
    if (!guild) return;
    try {
      const categoryId =
        await this.settingsService.getEphemeralVoiceCategoryId();
      const data = await buildRepointData(this.db, ev);
      const name = buildScheduledEventName(data);
      const channelId = await createVoiceChannel(guild, {
        name,
        parentId: categoryId,
      });
      // Persist BEFORE SE repoint so the reconcile cron resolves the channel.
      await setEphemeralChannelId(this.db, ev.id, channelId);
      await this.repointAndResync(ev, data);
      this.logger.log(
        `Created ephemeral voice channel ${channelId} for event ${ev.id}`,
      );
    } catch (err) {
      this.captureError('create', ev.id, err);
    }
  }

  /**
   * Destroy the ephemeral channel for an event IF currently empty. Never
   * deletes while occupied (re-checks member count). Flushes attendance first.
   */
  async destroyForEvent(ev: EphemeralEventRow): Promise<void> {
    const channelId = ev.ephemeralVoiceChannelId;
    if (!channelId) return;
    const guild = this.requireGuild();
    if (!guild) return;
    try {
      if (getChannelMemberCount(guild, channelId) > 0) {
        this.logger.debug(
          `Skip reap: ephemeral channel ${channelId} (event ${ev.id}) occupied`,
        );
        return;
      }
      await this.voiceAttendance
        ?.flushToDb()
        .catch((e) =>
          this.logger.warn(`Voice flush before reap failed: ${String(e)}`),
        );
      await deleteVoiceChannel(guild, channelId);
      await clearEphemeralChannelId(this.db, ev.id);
      await this.repointAndResync(ev, await buildRepointData(this.db, ev));
      this.logger.log(
        `Destroyed ephemeral voice channel ${channelId} for event ${ev.id}`,
      );
    } catch (err) {
      this.captureError('destroy', ev.id, err);
    }
  }

  /** Reload the row + reap if now empty (BullMQ idle processor entry point). */
  async destroyById(eventId: number): Promise<void> {
    const ev = await fetchEventForEphemeral(this.db, eventId);
    if (ev) await this.destroyForEvent(ev);
  }

  // ─── Private helpers ──────────────────────────────────────

  /** Re-resolve + edit the SE channel and trigger an embed re-sync. */
  private async repointAndResync(
    ev: EphemeralEventRow,
    data: {
      title: string;
      startTime: string;
      endTime: string;
      signupCount: number;
      game: { name: string } | null;
    },
  ): Promise<void> {
    await this.scheduledEventService.updateScheduledEvent(
      ev.id,
      data,
      ev.gameId,
    );
    await this.embedSyncQueue
      ?.enqueue(ev.id, 'ephemeral-voice')
      .catch((e) =>
        this.logger.warn(
          `Embed-sync enqueue failed for ${ev.id}: ${String(e)}`,
        ),
      );
  }

  private requireGuild(): Guild | null {
    if (!this.clientService.isConnected()) return null;
    return this.clientService.getGuild();
  }

  private captureError(phase: string, eventId: number, err: unknown): void {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    this.logger.error(`Ephemeral ${phase} failed for event ${eventId}: ${msg}`);
    Sentry.captureException(err, {
      tags: { context: `ephemeral-voice-${phase}` },
    });
  }
}
