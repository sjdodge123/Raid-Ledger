/**
 * ROK-2284 — one sign-in reminder pass: switch on → launch time (set once) →
 * roster (humans past the 3-day join wait) → drop account holders → upsert
 * rows → claim ≤25 due → DM each one DIRECTLY (never the notification queue,
 * so a closed DM can never deactivate anyone; these people have no user row
 * anyway). Success stamps the row; any error is recorded and counted as a
 * send, so a closed DM is tried at most once per cadence and stops at the cap.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { listGuildMembersForReminders } from '../../../discord-bot/discord-bot-client.guild.helpers';
import {
  claimDueSigninReminders,
  ensureSigninReminderRows,
  markSigninReminderSent,
  recordSigninReminderFailure,
} from './signin-reminder.db';
import { buildSigninReminderDm } from './signin-reminder.dm';
import { reminderCandidateIds } from './signin-reminder.eligibility';
import {
  ensureSigninReminderLaunchedAt,
  readSigninReminderSettings,
} from './signin-reminder.settings';

/** What one pass did. */
export type SigninReminderOutcome =
  | { status: 'disabled' | 'not-connected' | 'busy' }
  | { status: 'ran'; candidates: number; sent: number; failed: number };

/** The numeric Discord API error code on a thrown error, else null. */
export function discordErrorCode(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  return typeof err.code === 'number' ? err.code : null;
}

@Injectable()
export class SigninReminderService {
  private readonly logger = new Logger(SigninReminderService.name);
  /** In-process guard: a slow pass never overlaps the next tick. */
  private running = false;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly discord: DiscordBotClientService,
  ) {}

  async runTick(now: Date = new Date()): Promise<SigninReminderOutcome> {
    if (this.running) return { status: 'busy' };
    this.running = true;
    try {
      return await this.runPass(now);
    } finally {
      this.running = false;
    }
  }

  private async runPass(now: Date): Promise<SigninReminderOutcome> {
    const cfg = await readSigninReminderSettings(this.settings);
    if (!cfg.enabled) return { status: 'disabled' };
    if (!this.discord.isConnected()) return { status: 'not-connected' };
    const roster = await listGuildMembersForReminders(this.discord.getGuild());
    if (roster === null) return { status: 'not-connected' };
    const launchedAt = await ensureSigninReminderLaunchedAt(this.settings, now);
    const ids = await this.dropAccountHolders(
      reminderCandidateIds(roster, launchedAt, now),
    );
    await ensureSigninReminderRows(this.db, ids);
    const claimed = await claimDueSigninReminders(this.db, {
      candidateIds: ids,
      weeks: cfg.weeks,
      max: cfg.max,
    });
    const sent = await this.sendAll(claimed);
    return {
      status: 'ran',
      candidates: ids.length,
      sent,
      failed: claimed.length - sent,
    };
  }

  /** Drop ids with any user row (`<id>` or `unlinked:<id>`) — no row for them. */
  private async dropAccountHolders(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const keys = ids.flatMap((id) => [id, `unlinked:${id}`]);
    const rows = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(inArray(schema.users.discordId, keys));
    const taken = new Set(
      rows.map((r) => (r.discordId ?? '').replace(/^unlinked:/, '')),
    );
    return ids.filter((id) => !taken.has(id));
  }

  /** DM every claimed id in turn; returns how many sends succeeded. */
  private async sendAll(discordIds: readonly string[]): Promise<number> {
    if (discordIds.length === 0) return 0;
    const branding = await this.settings.getBranding();
    const clientUrl = await this.settings.getClientUrl();
    let sent = 0;
    for (const discordId of discordIds) {
      if (await this.sendOne(discordId, branding.communityName, clientUrl)) {
        sent += 1;
      }
    }
    return sent;
  }

  private async sendOne(
    discordId: string,
    communityName: string | null,
    clientUrl: string,
  ): Promise<boolean> {
    const { embed, row } = buildSigninReminderDm(communityName, clientUrl);
    try {
      await this.discord.sendEmbedDM(discordId, embed, row);
    } catch (err) {
      const code = discordErrorCode(err);
      await recordSigninReminderFailure(this.db, discordId, code);
      this.logger.warn(
        `Sign-in reminder DM to ${discordId} failed (code ${code ?? 'none'})`,
      );
      return false;
    }
    await markSigninReminderSent(this.db, discordId);
    return true;
  }
}
