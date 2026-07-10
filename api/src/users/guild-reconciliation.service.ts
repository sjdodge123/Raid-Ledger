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
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, isNotNull, isNull, not, like } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { DiscordNotificationService } from '../notifications/discord-notification.service';

const JOB_NAME = 'GuildReconciliationService_reconcileGuildMembers';

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
    const guildIds = await this.fetchCurrentGuildMemberIds();
    if (!guildIds) {
      this.logger.warn(
        '[ROK-1282] Reconciliation skipped — Discord bot disconnected',
      );
      return false;
    }
    const candidates = await this.loadActiveDbUsers();
    const gaps = candidates.filter((u) => !guildIds.has(u.discordId));
    await this.deactivateGap(gaps);
    this.logger.log(
      `[ROK-1282] Reconciliation deactivated ${gaps.length} user(s) ` +
        `(checked ${candidates.length} active DB user(s) against ${guildIds.size} guild member(s))`,
    );
  }

  /**
   * Pull the current guild member list.
   *
   * Returns null ONLY when the bot is disconnected (`getGuild()` returned
   * null inside the helper) — that's a benign no-op heartbeat. Discord API
   * errors (403, missing GuildMembers intent, network, rate-limit) bubble up
   * so `CronJobService` records a real failure instead of a healthy no-op.
   * Codex P2 (2026-05-14): the previous blanket catch hid every fault as
   * "bot disconnected", masking silent breakage.
   */
  private async fetchCurrentGuildMemberIds(): Promise<Set<string> | null> {
    return this.botClient.listAllGuildMemberIds();
  }

  /**
   * Active (not-yet-deactivated) users with a real Discord snowflake.
   * Excludes both `local:%` (email-only accounts) and `unlinked:%`
   * (previously linked users who unlinked) — neither is guild-trackable.
   */
  private async loadActiveDbUsers(): Promise<
    { id: number; discordId: string }[]
  > {
    const rows = await this.db
      .select({
        id: schema.users.id,
        discordId: schema.users.discordId,
      })
      .from(schema.users)
      .where(
        and(
          isNull(schema.users.deactivatedAt),
          isNotNull(schema.users.discordId),
          not(like(schema.users.discordId, 'local:%')),
          not(like(schema.users.discordId, 'unlinked:%')),
        ),
      );
    // SQL isNotNull(discordId) above guarantees non-null; Drizzle still infers
    // `string | null` from the nullable column, so assert the narrowed type.
    return rows as { id: number; discordId: string }[];
  }

  /** Deactivate each gap via the shared notification path (idempotent). */
  private async deactivateGap(gaps: { id: number }[]): Promise<void> {
    for (const u of gaps) {
      try {
        await this.discordNotificationService.deactivateUser(u.id);
      } catch (err: unknown) {
        this.logger.warn(
          `[ROK-1282] Failed to deactivate user ${u.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
