/**
 * ROK-1374 — escalate a passed `round_deadline` (D14, E13, AC17).
 *
 * Operator answer Q3, verbatim: no auto-resolve at `roundDeadline`. A passed
 * deadline notifies, louder — it never decides. Everything here is therefore
 * read-and-DM; the absence of any write is the feature, and the unit spec
 * asserts `db.update` is never called so that stays true.
 *
 * It lives outside `lineup-reminder.service.ts` (255 counted lines) and takes
 * its collaborators as a `deps` object so the service contributes six lines
 * and stays clear of the 300-line ceiling.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { DEDUP_TTL } from '../lineup-notification.constants';
import {
  loadOverdueActiveTiebreakers,
  type ActiveTiebreakerRow,
} from '../lineup-tiebreaker-reminder.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The notification payload this pass sends. Narrow by design. */
interface EscalationNotification {
  userId: number;
  type: 'community_lineup';
  title: string;
  message: string;
  payload: Record<string, unknown>;
}

/** Collaborators, injected so the pass is unit-testable without Nest. */
export interface TieEscalationDeps {
  db: Db;
  notifications: { create(input: EscalationNotification): Promise<unknown> };
  dedup: { checkAndMarkSent(key: string, ttl: number): Promise<boolean> };
  getClientUrl(): Promise<string | undefined>;
  logger: { warn(message: string): void };
}

/**
 * Who hears about a stalled round: the lineup creator (whose decision it is)
 * plus every active operator/admin (who can force it). Deliberately NOT the
 * voters — they have already done their part and cannot end the round.
 */
export async function loadEscalationRecipients(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const rows = (await db.execute(sql`
    SELECT u.id AS "userId"
      FROM users u
     WHERE u.deactivated_at IS NULL
       AND u.banned_at IS NULL
       AND (u.role IN ('operator', 'admin')
            OR u.id = (SELECT created_by FROM community_lineups
                        WHERE id = ${lineupId}))
     ORDER BY u.id
  `)) as unknown as Array<{ userId: number }>;
  return rows.map((r) => r.userId);
}

/**
 * The DM body. Names both human exits — pick or extend — because naming only
 * one would push every stalled round down the same path by omission.
 */
export function buildTiebreakerEscalationMessage(
  tb: ActiveTiebreakerRow,
  clientUrl: string | undefined,
): string {
  const headline = `Round ${tb.currentRound} closed without a result — pick a winner or extend the deadline.`;
  if (!clientUrl) return headline;
  return `${headline}\n\n[Open the lineup](${clientUrl}/community-lineup/${tb.lineupId})`;
}

/**
 * DM the creator + operators for every active tiebreaker whose round deadline
 * has passed. Returns the tiebreaker ids that actually sent something.
 *
 * One failure must not silence the rest, so each tiebreaker is isolated —
 * the same shape `runTiebreakerReminders` already uses.
 */
export async function escalateOverdueTiebreakers(
  deps: TieEscalationDeps,
  now: Date = new Date(),
): Promise<number[]> {
  const overdue = await loadOverdueActiveTiebreakers(deps.db, now);
  if (overdue.length === 0) return [];
  const clientUrl = await deps.getClientUrl();
  const escalated: number[] = [];
  for (const tb of overdue) {
    try {
      if (await escalateOne(deps, tb, clientUrl)) {
        escalated.push(tb.tiebreakerId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.warn(
        `Tiebreaker escalation failed for tb ${tb.tiebreakerId} (lineup ${tb.lineupId}): ${msg}`,
      );
    }
  }
  return escalated;
}

/**
 * Reuses the reminder cron's dedup mechanism with its own key namespace, so a
 * stalled round escalates once per recipient for the DEDUP_TTL week rather
 * than every five minutes for as long as it stays stalled.
 */
async function escalateOne(
  deps: TieEscalationDeps,
  tb: ActiveTiebreakerRow,
  clientUrl: string | undefined,
): Promise<boolean> {
  const userIds = await loadEscalationRecipients(deps.db, tb.lineupId);
  const message = buildTiebreakerEscalationMessage(tb, clientUrl);
  let sent = false;
  for (const userId of userIds) {
    const key = `tiebreaker-escalation:${tb.tiebreakerId}:${userId}`;
    if (await deps.dedup.checkAndMarkSent(key, DEDUP_TTL)) continue;
    await deps.notifications.create({
      userId,
      type: 'community_lineup',
      title: 'Tiebreaker Round Closed',
      message,
      payload: {
        subtype: 'lineup_tiebreaker_escalation',
        lineupId: tb.lineupId,
        tiebreakerId: tb.tiebreakerId,
        mode: tb.mode,
        round: tb.currentRound,
      },
    });
    sent = true;
  }
  return sent;
}
