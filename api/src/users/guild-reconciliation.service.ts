/**
 * GuildReconciliationService (ROK-1282) — daily sweep that diffs the
 * Discord guild's member list against DB users and deactivates anyone
 * whose `discord_id` is no longer present.
 *
 * Layer 3 of the user-deactivation stack:
 *   1. Reactive: 50278 classifier in discord-notification.processor.ts
 *      — fires when a DM fails; misses users who never get a DM.
 *   2. Reactive: GuildMemberAddListener — re-enables on rejoin; nothing
 *      on the leave side (ROK-1260 spec mentioned a `GuildMemberRemove`
 *      listener that was never shipped).
 *   3. Proactive: this service — fills both gaps with a daily 07:00 UTC
 *      reconciliation that runs even when the bot was offline during
 *      a `GuildMemberRemove` event.
 *
 * The actual deactivation goes through `DiscordNotificationService.deactivateUser`
 * (idempotent), so audit-trail and cascade behaviour matches the reactive path.
 *
 * ROK-1714: the same member fetch also refreshes `users.avatar` from each
 * member's GLOBAL avatar hash (including clearing it when the avatar was
 * removed). This is not a new deactivation layer and adds no listener — it
 * reuses the list this sweep already pulls once a day.
 *
 * ROK-1749: the sweep is scoped to users who were actually guild members.
 * Each pass first stamps `guild_member_seen_at` on every active user found in
 * the member list, then only stamped users are reconciliation candidates — a
 * Discord-OAuth guest (poll link / PUG invite) never in the guild stays active.
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  not,
  like,
  sql,
} from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { GuildMemberAvatars } from '../discord-bot/discord-bot-client.guild.helpers';
import { invalidateAuthUser } from '../auth/auth-user-cache';
import { DiscordNotificationService } from '../notifications/discord-notification.service';

const JOB_NAME = 'GuildReconciliationService_reconcileGuildMembers';

/** Bound on the `discord_id IN (...)` list per stamp UPDATE (ROK-1749). */
const STAMP_CHUNK = 500;

/** Active (not deactivated) users with a real, guild-trackable snowflake. */
const activeSnowflakeUser = () =>
  and(
    isNull(schema.users.deactivatedAt),
    isNotNull(schema.users.discordId),
    not(like(schema.users.discordId, 'local:%')),
    not(like(schema.users.discordId, 'unlinked:%')),
  );

type ActiveUser = { id: number; discordId: string; avatar: string | null };

@Injectable()
export class GuildReconciliationService {
  private readonly logger = new Logger(GuildReconciliationService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
    private readonly botClient: DiscordBotClientService,
    @Inject(forwardRef(() => DiscordNotificationService))
    private readonly discordNotificationService: DiscordNotificationService,
  ) {}

  @Cron('0 0 7 * * *', { name: JOB_NAME })
  async reconcileCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB_NAME, () =>
      this.runReconciliation(),
    );
  }

  /**
   * Run a single reconciliation pass. Returns `false` when the bot is
   * disconnected so CronJobService records a no-op + heartbeat (not a
   * failure). Public so the integration test can call it directly.
   */
  async runReconciliation(): Promise<void | false> {
    const members = await this.fetchCurrentGuildMembers();
    if (!members) {
      this.logger.warn(
        '[ROK-1282] Reconciliation skipped — Discord bot disconnected',
      );
      return false;
    }
    await this.stampSeenMembers([...members.keys()]);
    const candidates = await this.loadActiveDbUsers();
    const skipped = await this.countNeverSeen();
    const gaps = candidates.filter((u) => !members.has(u.discordId));
    await this.deactivateGap(gaps);
    this.logger.log(
      `[ROK-1282] Reconciliation deactivated ${gaps.length} user(s) ` +
        `(checked ${candidates.length} active DB user(s) against ${members.size} guild member(s); ` +
        `skipped ${skipped} never-seen-in-guild user(s))`,
    );
    await this.syncAvatars(candidates, members);
  }

  /**
   * Pull the current guild member list (Discord ID → global avatar hash).
   *
   * Returns null ONLY when the bot is disconnected (`getGuild()` returned
   * null inside the helper) — that's a benign no-op heartbeat. Discord API
   * errors (403, missing GuildMembers intent, network, rate-limit) bubble up
   * so `CronJobService` records a real failure instead of a healthy no-op.
   * Codex P2 (2026-05-14): the previous blanket catch hid every fault as
   * "bot disconnected", masking silent breakage.
   */
  private async fetchCurrentGuildMembers(): Promise<GuildMemberAvatars | null> {
    return this.botClient.listAllGuildMemberAvatars();
  }

  /**
   * ROK-1749: stamp `guild_member_seen_at` on every active user present in the
   * fetched member list (chunked, bounded). Runs BEFORE candidates load, so
   * the first sweep after deploy stamps every current member — no backfill.
   */
  private async stampSeenMembers(memberIds: string[]): Promise<void> {
    const now = new Date();
    for (let i = 0; i < memberIds.length; i += STAMP_CHUNK) {
      await this.db
        .update(schema.users)
        .set({ guildMemberSeenAt: now })
        .where(
          and(
            activeSnowflakeUser(),
            inArray(
              schema.users.discordId,
              memberIds.slice(i, i + STAMP_CHUNK),
            ),
          ),
        );
    }
  }

  /** ROK-1749: active snowflake users never seen in the guild (log only). */
  private async countNeverSeen(): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(schema.users)
      .where(
        and(activeSnowflakeUser(), isNull(schema.users.guildMemberSeenAt)),
      );
    return Number(row?.n ?? 0);
  }

  /**
   * Active (not-yet-deactivated) users with a real Discord snowflake who were
   * seen in the guild at least once (ROK-1749 `guild_member_seen_at IS NOT
   * NULL`). Excludes `local:%` (email-only) and `unlinked:%` (unlinked) ids —
   * neither is guild-trackable — and never-seen OAuth guests.
   */
  private async loadActiveDbUsers(): Promise<ActiveUser[]> {
    const rows = await this.db
      .select({
        id: schema.users.id,
        discordId: schema.users.discordId,
        avatar: schema.users.avatar,
      })
      .from(schema.users)
      .where(
        and(activeSnowflakeUser(), isNotNull(schema.users.guildMemberSeenAt)),
      );
    // SQL isNotNull(discordId) above guarantees non-null; Drizzle still infers
    // `string | null` from the nullable column, so assert the narrowed type.
    return rows as ActiveUser[];
  }

  /** Deactivate each gap via the shared notification path (idempotent). */
  private async deactivateGap(gaps: { id: number }[]): Promise<void> {
    for (const u of gaps) {
      try {
        await this.discordNotificationService.deactivateUser(
          u.id,
          'reconciliation-sweep',
        );
      } catch (err: unknown) {
        this.logger.warn(
          `[ROK-1282] Failed to deactivate user ${u.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * ROK-1714: write each still-in-guild member's global avatar hash onto
   * their row when it differs (a removed avatar clears it to NULL). Runs
   * after deactivation so a failure here can never block Layer 3.
   */
  private async syncAvatars(
    candidates: ActiveUser[],
    members: GuildMemberAvatars,
  ): Promise<void> {
    const stale = candidates.filter(
      (u) => members.has(u.discordId) && members.get(u.discordId) !== u.avatar,
    );
    let updated = 0;
    for (const u of stale) {
      const avatar = members.get(u.discordId) ?? null;
      if (await this.writeAvatar(u.id, avatar)) updated++;
    }
    this.logger.log(`[ROK-1714] Avatar sync updated ${updated} user(s)`);
  }

  /** Conditional write; true when the row actually changed. Never throws. */
  private async writeAvatar(
    userId: number,
    avatar: string | null,
  ): Promise<boolean> {
    try {
      const rows = await this.db
        .update(schema.users)
        .set({ avatar, updatedAt: new Date() })
        .where(
          and(
            eq(schema.users.id, userId),
            sql`${schema.users.avatar} IS DISTINCT FROM ${avatar}`,
          ),
        )
        .returning({ id: schema.users.id });
      if (rows.length > 0) invalidateAuthUser(userId);
      return rows.length > 0;
    } catch (err: unknown) {
      this.logger.warn(
        `[ROK-1714] Failed to sync avatar for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
