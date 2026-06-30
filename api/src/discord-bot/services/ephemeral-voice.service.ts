import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { OverwriteResolvable } from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { ScheduledEventService } from './scheduled-event.service';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { VoiceAttendanceService } from './voice-attendance.service';
import {
  buildEphemeralChannelName,
  buildScheduledEventNameWithTime,
} from './scheduled-event.helpers';
import { shouldCreateEphemeralChannel } from './ephemeral-voice.gate.helpers';
import {
  applyPrivateVoiceOverwrites,
  createVoiceChannel,
  deleteVoiceChannel,
  disconnectMember,
  getChannelMemberCountFresh,
  getEphemeralChannelName,
  renameVoiceChannel,
  reconcileScheduledEventName,
} from './ephemeral-voice.discord-ops';
import {
  type EphemeralEventRow,
  type NameReconcileRow,
  type RepointEventData,
  buildRepointData,
  claimEphemeralChannelId,
  clearEphemeralChannelId,
  fetchEventForEphemeral,
  fetchRosterSignupRows,
  findEventByEphemeralChannel,
} from './ephemeral-voice.db-helpers';
import {
  buildPrivateVoiceOverwrites,
  computeAllowedDiscordIds,
} from './ephemeral-voice.private.helpers';

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

  /** Resolve the effective gate for an event (global → forced → per-event). */
  async shouldCreate(ev: EphemeralEventRow): Promise<boolean> {
    const globalEnabled = await this.settingsService.getEphemeralVoiceEnabled();
    if (!globalEnabled) return false;
    const forced = await this.settingsService.getEphemeralVoiceForced();
    return shouldCreateEphemeralChannel(
      globalEnabled,
      forced,
      ev.ephemeralVoiceEnabled,
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
      const name = buildEphemeralChannelName(data);
      // ROK-1386: seed the roster-only overwrites in the same channels.create
      // call so a private channel is locked before anyone can race in.
      const permissionOverwrites = ev.privateVoice
        ? await this.buildSeedOverwrites(ev, guild.id)
        : undefined;
      const channelId = await createVoiceChannel(guild, {
        name,
        parentId: categoryId,
        permissionOverwrites,
      });
      // Atomically claim the slot (set id only if still null). If an overlapping
      // scan already created a channel, delete the one we just made so we don't
      // orphan a duplicate (Codex review). Persist BEFORE SE repoint so the
      // reconcile cron resolves the channel.
      const claimed = await claimEphemeralChannelId(this.db, ev.id, channelId);
      if (!claimed) {
        await deleteVoiceChannel(guild, channelId);
        return;
      }
      await this.repointAndResync(ev, data);
      this.logger.log(
        `Created ephemeral voice channel ${channelId} for event ${ev.id}`,
      );
    } catch (err) {
      this.captureError('create', ev.id, err);
    }
  }

  /**
   * Destroy the ephemeral channel for an event. By default never deletes while
   * occupied (re-checks member count) — the reaper/idle path. Pass `force` for
   * cancel/delete, where the event is gone and the channel must not be orphaned
   * even if someone is still in it. Flushes attendance first.
   */
  async destroyForEvent(
    ev: EphemeralEventRow,
    opts?: { force?: boolean },
  ): Promise<void> {
    const channelId = ev.ephemeralVoiceChannelId;
    if (!channelId) return;
    const guild = this.requireGuild();
    if (!guild) return;
    try {
      if (
        !opts?.force &&
        (await getChannelMemberCountFresh(guild, channelId)) > 0
      ) {
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

  /**
   * Reload the row + destroy. Idle processor passes no opts (occupancy-safe);
   * cancel/delete lifecycle passes `force` so the channel is never orphaned.
   */
  async destroyById(
    eventId: number,
    opts?: { force?: boolean },
  ): Promise<void> {
    const ev = await fetchEventForEphemeral(this.db, eventId);
    if (ev) await this.destroyForEvent(ev, opts);
  }

  /**
   * Reconcile an in-flight ephemeral event's Discord display names (voice channel
   * + Scheduled Event) to the current naming scheme. Backfills existing channels
   * on the first post-deploy tick and self-heals drift. Discord-display only —
   * the stored event title is never touched. Renames each surface ONLY when its
   * current Discord name differs, so it fires once then settles (channel renames
   * are rate-limited to ~2/10min). Skips non-ephemeral / no-guild rows.
   */
  async reconcileNamesForEvent(ev: NameReconcileRow): Promise<void> {
    const channelId = ev.ephemeralVoiceChannelId;
    if (!channelId) return;
    const guild = this.requireGuild();
    if (!guild) return;
    const data = await buildRepointData(this.db, ev);
    await this.reconcileChannelName(guild, ev.id, channelId, data);
    await this.reconcileSeName(guild, ev, data);
  }

  /**
   * ROK-1386: full-reconcile a private event's channel overwrites against the
   * current rostered allow-list (adds newly rostered, removes demoted/benched).
   * No-op unless the event is private AND has a live channel. Hooked debounced
   * on signup/roster fan-out so bench↔roster moves re-sync; the join-guard
   * backstops sync lag.
   */
  async syncVoiceAccess(eventId: number): Promise<void> {
    const ev = await fetchEventForEphemeral(this.db, eventId);
    if (!ev?.privateVoice || !ev.ephemeralVoiceChannelId) return;
    const guild = this.requireGuild();
    const botId = this.clientService.getClientId();
    if (!guild || !botId) return;
    try {
      const desired = await this.resolveAllowedIds(eventId);
      await applyPrivateVoiceOverwrites(
        guild,
        ev.ephemeralVoiceChannelId,
        desired,
        botId,
      );
    } catch (err) {
      this.captureError('sync-access', eventId, err);
    }
  }

  /**
   * ROK-1386 join-guard: disconnect a member who joined a private ephemeral
   * channel without being on the roster allow-list. This is the REAL
   * enforcement — overwrites only block future connects and a create-race
   * window exists. Block re-entry only; only ever called on join transitions,
   * never on demotion (so already-connected members are not kicked).
   */
  async enforceJoinGuard(
    channelId: string,
    discordUserId: string,
  ): Promise<void> {
    const ev = await findEventByEphemeralChannel(this.db, channelId);
    if (!ev?.privateVoice || ev.ephemeralVoiceChannelId !== channelId) return;
    // Never disconnect the bot itself — it joins to record voice attendance and
    // will never be on the roster allow-list, so without this guard the join-
    // guard would self-kick the bot (latent footgun, ROK-1386 review).
    if (discordUserId === this.clientService.getClientId()) return;
    const guild = this.requireGuild();
    if (!guild) return;
    try {
      const allowed = await this.resolveAllowedIds(ev.id);
      if (allowed.has(discordUserId)) return;
      await disconnectMember(guild, discordUserId);
    } catch (err) {
      this.captureError('join-guard', ev.id, err);
    }
  }

  // ─── Private helpers ──────────────────────────────────────

  /** Rename the channel only when its current Discord name differs (no churn). */
  private async reconcileChannelName(
    guild: Guild,
    eventId: number,
    channelId: string,
    data: RepointEventData,
  ): Promise<void> {
    const expected = buildEphemeralChannelName(data);
    const current = getEphemeralChannelName(guild, channelId);
    if (current === null || current === expected) return;
    try {
      await renameVoiceChannel(guild, channelId, expected);
      this.logger.log(
        `Renamed ephemeral channel ${channelId} (event ${eventId}) → "${expected}"`,
      );
    } catch (err) {
      this.logger.warn(
        `Ephemeral channel rename skipped for event ${eventId} (rate-limit/API), will retry: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /** Reconcile the SE name (with start-time suffix) only when it differs. */
  private async reconcileSeName(
    guild: Guild,
    ev: NameReconcileRow,
    data: RepointEventData,
  ): Promise<void> {
    const seId = ev.discordScheduledEventId;
    if (!seId) return;
    try {
      const tz = await this.settingsService.getDefaultTimezone();
      const expected = buildScheduledEventNameWithTime(data, tz);
      if (await reconcileScheduledEventName(guild, seId, expected))
        this.logger.log(
          `Renamed ephemeral SE ${seId} (event ${ev.id}) → "${expected}"`,
        );
    } catch (err) {
      this.logger.warn(
        `Ephemeral SE rename skipped for event ${ev.id}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /** Resolve the rostered-only Discord-id allow-list for an event (ROK-1386). */
  private async resolveAllowedIds(eventId: number): Promise<Set<string>> {
    const rows = await fetchRosterSignupRows(this.db, eventId);
    return computeAllowedDiscordIds(rows);
  }

  /** Build seed overwrites for a private channel at create time (ROK-1386). */
  private async buildSeedOverwrites(
    ev: EphemeralEventRow,
    guildId: string,
  ): Promise<OverwriteResolvable[] | undefined> {
    const botId = this.clientService.getClientId();
    if (!botId) {
      // Fail-open: without the bot id we cannot seed roster overwrites, so the
      // channel is created fully OPEN. The join-guard still backstops intruders,
      // but flag the gap loudly for observability (ROK-1386 review).
      const message =
        'private ephemeral channel created WITHOUT overwrites — Discord client not ready; relying on join-guard';
      this.logger.warn(`${message} (event ${ev.id})`);
      Sentry.addBreadcrumb({
        category: 'ephemeral-voice',
        level: 'warning',
        message,
        data: { eventId: ev.id },
      });
      return undefined;
    }
    const allowedDiscordIds = await this.resolveAllowedIds(ev.id);
    return buildPrivateVoiceOverwrites({ guildId, botId, allowedDiscordIds });
  }

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
