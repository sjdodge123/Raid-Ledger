/**
 * ROK-2284 — row-level state for the sign-in reminder DM job, keyed by
 * Discord id (`discord_signin_reminders`). Claim-then-stamp like the GG DM
 * wave (`gg-dm-wave.helpers.ts`): a tick claims ≤25 due rows with
 * `FOR UPDATE SKIP LOCKED` (two ticks never share a row), each send either
 * stamps the row as sent or records a failure, and both clear the claim.
 * A claim older than `SIGNIN_REMINDER_STALE_CLAIM_MINUTES` (process died
 * mid-send) is claimable again. A failed DM with a Discord error code counts
 * as a send, so a closed DM is retried at most once per cadence and stops at
 * the cap; a code-less error only releases the claim (retried next tick).
 */
import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { discordSigninReminders } from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Any handle the helpers can run on — the pool or an open transaction. */
export type SigninReminderDb = Db | Tx;

/** At most this many DMs per hourly tick (ruled Q9). */
export const SIGNIN_REMINDER_BATCH = 25;

/** A claim this old that was never stamped is treated as abandoned. */
export const SIGNIN_REMINDER_STALE_CLAIM_MINUTES = 30;

/** Discord "Cannot send messages to this user" (DMs closed / bot blocked). */
export const DISCORD_DM_CLOSED_CODE = 50007;

/** Inputs of one claim: who is in the guild now, and the admin settings. */
export interface SigninReminderClaimInput {
  /** Current human guild members to consider (roster-filtered by the caller). */
  candidateIds: readonly string[];
  /** Cadence in weeks between two reminders to the same person. */
  weeks: number;
  /** Lifetime maximum reminders per person. */
  max: number;
  /** Batch size; defaults to `SIGNIN_REMINDER_BATCH`. */
  limit?: number;
  /**
   * DEMO_MODE bot-targeted tick only: skip the "no user row" check. The smoke
   * setup links the companion BOT's Discord id to a demo user, and the
   * caller has already reduced `candidateIds` to that one bot. Never set by
   * the cron.
   */
  includeAccountHolders?: boolean;
}

function idList(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

/** No Raid Ledger user row (`<id>` or `unlinked:<id>`) for the reminder row. */
function noAccountRow(): SQL {
  return sql`AND NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.discord_id IN (r.discord_id, 'unlinked:' || r.discord_id))`;
}

/** Make sure every candidate has a row (new ones start at count 0). */
export async function ensureSigninReminderRows(
  db: SigninReminderDb,
  discordIds: readonly string[],
): Promise<void> {
  if (discordIds.length === 0) return;
  await db
    .insert(discordSigninReminders)
    .values(discordIds.map((discordId) => ({ discordId })))
    .onConflictDoNothing({ target: discordSigninReminders.discordId });
}

/**
 * Claim up to `limit` due rows among `candidateIds`. Due = not opted out,
 * under the cap, last reminder (or failed attempt) at least `weeks` ago or
 * never, no live claim, and no Raid Ledger user row for that Discord id
 * (`discord_id` or `unlinked:<id>`). Never-reminded people go first.
 */
export async function claimDueSigninReminders(
  db: SigninReminderDb,
  input: SigninReminderClaimInput,
): Promise<string[]> {
  if (input.candidateIds.length === 0) return [];
  const limit = input.limit ?? SIGNIN_REMINDER_BATCH;
  const rows = await db.execute<{ discord_id: string }>(sql`
    UPDATE discord_signin_reminders SET claimed_at = now()
    WHERE discord_id IN (
      SELECT r.discord_id FROM discord_signin_reminders r
      WHERE r.discord_id IN (${idList(input.candidateIds)})
        AND r.opted_out_at IS NULL
        AND r.sent_count < ${input.max}
        AND (r.last_sent_at IS NULL
          OR r.last_sent_at <= now() - make_interval(weeks => ${input.weeks}))
        -- Belt-and-braces: a failure also sets last_sent_at, so the cadence
        -- clause above already covers a 50007; kept so a hand-edited row
        -- cannot re-open a closed DM early.
        AND (r.last_failure_code IS DISTINCT FROM ${DISCORD_DM_CLOSED_CODE}
          OR r.last_failure_at <= now() - make_interval(weeks => ${input.weeks}))
        AND (r.claimed_at IS NULL
          OR r.claimed_at < now() - make_interval(mins => ${SIGNIN_REMINDER_STALE_CLAIM_MINUTES}))
        ${input.includeAccountHolders ? sql`` : noAccountRow()}
      ORDER BY r.last_sent_at ASC NULLS FIRST, r.discord_id
      LIMIT ${limit}
      FOR UPDATE OF r SKIP LOCKED
    )
    RETURNING discord_id`);
  return Array.from(rows).map((r) => String(r.discord_id));
}

/** Stamp a claimed row as delivered: count it, start the cadence, drop the claim. */
export async function markSigninReminderSent(
  db: SigninReminderDb,
  discordId: string,
): Promise<void> {
  await db
    .update(discordSigninReminders)
    .set({
      sentCount: sql`${discordSigninReminders.sentCount} + 1`,
      lastSentAt: sql`now()`,
      claimedAt: null,
    })
    .where(eq(discordSigninReminders.discordId, discordId));
}

/**
 * Record a failed DM. It counts as a send (count + cadence clock) so the
 * person is not retried on a loop; `code` is the Discord error code if known.
 */
export async function recordSigninReminderFailure(
  db: SigninReminderDb,
  discordId: string,
  code: number | null,
): Promise<void> {
  await db
    .update(discordSigninReminders)
    .set({
      sentCount: sql`${discordSigninReminders.sentCount} + 1`,
      lastSentAt: sql`now()`,
      lastFailureAt: sql`now()`,
      lastFailureCode: code,
      claimedAt: null,
    })
    .where(eq(discordSigninReminders.discordId, discordId));
}

/**
 * Drop a claim WITHOUT counting it (a code-less error such as the bot
 * disconnecting mid-pass): the person keeps their reminder and the next tick
 * retries.
 */
export async function releaseSigninReminderClaim(
  db: SigninReminderDb,
  discordId: string,
): Promise<void> {
  await db
    .update(discordSigninReminders)
    .set({ claimedAt: null })
    .where(eq(discordSigninReminders.discordId, discordId));
}

/**
 * Right before a send: if the person opted out after the batch was claimed
 * (pressed the button on an earlier DM mid-pass), drop the claim and return
 * true so the caller skips the send.
 */
export async function releaseIfOptedOut(
  db: SigninReminderDb,
  discordId: string,
): Promise<boolean> {
  const rows = await db
    .update(discordSigninReminders)
    .set({ claimedAt: null })
    .where(
      and(
        eq(discordSigninReminders.discordId, discordId),
        isNotNull(discordSigninReminders.optedOutAt),
      ),
    )
    .returning({ discordId: discordSigninReminders.discordId });
  return rows.length > 0;
}

/**
 * "Don't remind me again": set `opted_out_at` for this Discord id, creating
 * the row if needed. Idempotent — a second press keeps the first timestamp.
 */
export async function optOutOfSigninReminders(
  db: SigninReminderDb,
  discordId: string,
): Promise<void> {
  await db
    .insert(discordSigninReminders)
    .values({ discordId, optedOutAt: sql`now()` })
    .onConflictDoUpdate({
      target: discordSigninReminders.discordId,
      set: {
        optedOutAt: sql`COALESCE(${discordSigninReminders.optedOutAt}, now())`,
      },
    });
}
