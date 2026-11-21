/**
 * ROK-2284 — one sign-in reminder pass: switch on → launch time (set once) →
 * roster (humans past the 3-day join wait) → drop account holders → upsert
 * rows → claim ≤25 due → DM each one DIRECTLY (never the notification queue,
 * so a closed DM can never deactivate anyone; these people have no user row
 * anyway). Each send first rechecks the opt-out. Success stamps the row; a
 * Discord-coded error (50007…) is recorded and counted as a send, so a closed
 * DM is tried at most once per cadence and stops at the cap; a code-less
 * error (bot dropped mid-pass) only releases the claim for the next tick.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import {
  listGuildMembersForReminders,
  type ReminderRosterMember,
} from '../../../discord-bot/discord-bot-client.guild.helpers';
import {
  claimDueSigninReminders,
  ensureSigninReminderRows,
  markSigninReminderSent,
  recordSigninReminderFailure,
  releaseIfOptedOut,
  releaseSigninReminderClaim,
} from './signin-reminder.db';
import { buildSigninReminderDm } from './signin-reminder.dm';
import {
  reminderCandidateIds,
  targetedBotIds,
} from './signin-reminder.eligibility';
import {
  ensureSigninReminderLaunchedAt,
  readSigninReminderSettings,
} from './signin-reminder.settings';

/** What one pass did. */
export type SigninReminderOutcome =
  | { status: 'disabled' | 'not-connected' | 'busy' }
  | { status: 'ran'; candidates: number; sent: number; failed: number };

/**
 * DEMO_MODE fixture only (`/admin/test/signin-reminder/tick`): aim the pass
 * at one BOT guild member instead of the human roster, so a smoke run never
 * DMs a person. The account-holder skip is bypassed for that bot only (the
 * smoke links the companion bot to a demo user), and so is the on/off switch
 * (unset ⇒ OFF under DEMO_MODE; the pass can only reach that bot). The cron
 * never passes options.
 */
export interface SigninReminderTickOptions {
  onlyBotId?: string;
}

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

  async runTick(
    now: Date = new Date(),
    opts: SigninReminderTickOptions = {},
  ): Promise<SigninReminderOutcome> {
    if (this.running) return { status: 'busy' };
    this.running = true;
    try {
      return await this.runPass(now, opts);
    } finally {
      this.running = false;
    }
  }

  private async runPass(
    now: Date,
    opts: SigninReminderTickOptions,
  ): Promise<SigninReminderOutcome> {
    const targeted = opts.onlyBotId !== undefined;
    const cfg = await readSigninReminderSettings(this.settings);
    if (!cfg.enabled && !targeted) return { status: 'disabled' };
    if (!this.discord.isConnected()) return { status: 'not-connected' };
    const roster = await listGuildMembersForReminders(this.discord.getGuild());
    if (roster === null) return { status: 'not-connected' };
    // Stamp the launch only on an ENABLED pass: a DEMO bot-only tick with the
    // switch off must not start the backdated first wave (ruling 2026-11-21).
    const launchedAt = cfg.enabled
      ? await ensureSigninReminderLaunchedAt(this.settings, now)
      : now;
    const ids = await this.candidates(roster, launchedAt, now, opts);
    await ensureSigninReminderRows(this.db, ids);
    const claimed = await claimDueSigninReminders(this.db, {
      candidateIds: ids,
      weeks: cfg.weeks,
      max: cfg.max,
      ...(targeted ? { includeAccountHolders: true } : {}),
    });
    const { sent, failed } = await this.sendAll(claimed);
    return { status: 'ran', candidates: ids.length, sent, failed };
  }

  /** The roster's due-to-consider ids, or just the targeted bot (DEMO). */
  private async candidates(
    roster: readonly ReminderRosterMember[],
    launchedAt: Date,
    now: Date,
    opts: SigninReminderTickOptions,
  ): Promise<string[]> {
    if (opts.onlyBotId !== undefined) {
      return targetedBotIds(roster, opts.onlyBotId);
    }
    return this.dropAccountHolders(
      reminderCandidateIds(roster, launchedAt, now),
    );
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

  /** DM every claimed id in turn; tallies delivered and failed sends. */
  private async sendAll(
    discordIds: readonly string[],
  ): Promise<{ sent: number; failed: number }> {
    const tally = { sent: 0, failed: 0 };
    if (discordIds.length === 0) return tally;
    const branding = await this.settings.getBranding();
    const clientUrl = await this.settings.getClientUrl();
    for (const discordId of discordIds) {
      const result = await this.sendOne(
        discordId,
        branding.communityName,
        clientUrl,
      );
      if (result !== 'skipped') tally[result] += 1;
    }
    return tally;
  }

  private async sendOne(
    discordId: string,
    communityName: string | null,
    clientUrl: string,
  ): Promise<'sent' | 'failed' | 'skipped'> {
    if (await releaseIfOptedOut(this.db, discordId)) return 'skipped';
    const { embed, row } = buildSigninReminderDm(communityName, clientUrl);
    try {
      await this.discord.sendEmbedDM(discordId, embed, row);
    } catch (err) {
      await this.recordFailure(discordId, err);
      return 'failed';
    }
    await markSigninReminderSent(this.db, discordId);
    return 'sent';
  }

  /** Coded Discord error ⇒ counted; code-less ⇒ claim released, retry. */
  private async recordFailure(discordId: string, err: unknown): Promise<void> {
    const code = discordErrorCode(err);
    if (code === null) {
      await releaseSigninReminderClaim(this.db, discordId);
    } else {
      await recordSigninReminderFailure(this.db, discordId, code);
    }
    this.logger.warn(
      `Sign-in reminder DM to ${discordId} failed (code ${code ?? 'none'}${code === null ? ', will retry' : ''})`,
    );
  }
}
