/**
 * Recover a lock-in claim whose request died before linking (ROK-2033).
 *
 * A claim stamps `lock_in_claimed_at`; the link clears it in the same write
 * that sets `linked_event_id` (`scheduling-lockin-claim.helpers`). So
 * `status = 'scheduled' AND linked_event_id IS NULL AND lock_in_claimed_at IS
 * NOT NULL` is exactly "claimed and never linked" — a crash orphan, or a
 * request still in flight. A locked-in event deleted on purpose leaves the
 * stamp NULL (the FK only nulls the link), so it is never selected.
 *
 * Recovery releases FIRST, fenced on the token: if the in-flight request
 * linked or released meanwhile, the release matches nothing and nothing else
 * is touched. Only after a winning release are the claim's orphaned events
 * (created from this poll at or after the claim) deleted through
 * `EventsService.delete`, so their DELETED listeners remove any Discord post.
 * A late in-flight link then fails its own token check and discards its
 * events (the existing lost-link branch).
 *
 * The prior status is not stored: recovery restores `scheduling`.
 */
import type { Logger } from '@nestjs/common';
import { and, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const m = schema.communityLineupMatches;
const e = schema.events;

/** A claim older than this is presumed dead (5x the longest proxy timeout). */
export const LOCK_IN_CLAIM_STALE_MS = 10 * 60_000;

/** Who recovered the claim — logged for the audit trail. */
export type LockInRecoveryActor =
  { kind: 'cron' } | { kind: 'admin'; userId: number };

export interface LockInRecoveryDeps {
  db: Db;
  eventsService: {
    delete(id: number, userId: number, isAdmin: boolean): Promise<void>;
  };
  pollEmbed: { fireUpdateEmbed(matchId: number): void };
  logger: Pick<Logger, 'warn' | 'error'>;
}

export interface LockInRecoveryResult {
  recovered: boolean;
  discardedEventIds: number[];
}

/** A stamped, unlinked claim. */
export interface PendingLockInClaim {
  matchId: number;
  claimedAt: Date;
}

/** The "claimed and never linked" predicate (see file header). */
const claimedNeverLinked = and(
  eq(m.status, 'scheduled'),
  isNull(m.linkedEventId),
  isNotNull(m.lockInClaimedAt),
);

/** Every claim at least `thresholdMs` old that never linked (the cron set). */
export async function findStaleClaims(
  db: Db,
  now: Date,
  thresholdMs: number = LOCK_IN_CLAIM_STALE_MS,
): Promise<PendingLockInClaim[]> {
  const cutoff = new Date(now.getTime() - thresholdMs);
  const rows = await db
    .select({ matchId: m.id, claimedAt: m.lockInClaimedAt })
    .from(m)
    .where(and(claimedNeverLinked, lte(m.lockInClaimedAt, cutoff)));
  return toPending(rows);
}

/** This match's unlinked claim of any age, or null (the admin action's gate). */
export async function findRecoverableClaim(
  db: Db,
  matchId: number,
): Promise<PendingLockInClaim | null> {
  const rows = await db
    .select({ matchId: m.id, claimedAt: m.lockInClaimedAt })
    .from(m)
    .where(and(eq(m.id, matchId), claimedNeverLinked));
  return toPending(rows)[0] ?? null;
}

function toPending(
  rows: { matchId: number; claimedAt: Date | null }[],
): PendingLockInClaim[] {
  const out: PendingLockInClaim[] = [];
  for (const { matchId, claimedAt } of rows) {
    if (claimedAt !== null) out.push({ matchId, claimedAt });
  }
  return out;
}

/**
 * Token-fenced release back to `scheduling`. Returns the release's DB time as
 * a raw `timestamp` string (the type and session zone of `events.created_at`,
 * which the driver hands back unparsed), or null when the claim moved.
 */
async function releaseRecoveredClaim(
  db: Db,
  claim: PendingLockInClaim,
): Promise<string | null> {
  const rows = await db
    .update(m)
    .set({ status: 'scheduling', lockInClaimedAt: null })
    .where(
      and(
        eq(m.id, claim.matchId),
        eq(m.status, 'scheduled'),
        isNull(m.linkedEventId),
        eq(m.lockInClaimedAt, claim.claimedAt),
      ),
    )
    .returning({ releasedAt: sql<string>`now()::timestamp` });
  return rows[0]?.releasedAt ?? null;
}

/**
 * Events the dead claim created: from this poll, created between the claim
 * and the release. Recurring instances share `created_from_poll_id` via the
 * base insert values.
 *
 * Upper bound: once the release commits the poll is `scheduling` again, so a
 * fresh lock-in (whose claim commits before its create) or `POST /events` may
 * create from it before this lookup runs; `created_at <= releasedAt` keeps
 * those out (ROK-2033 review MINOR 1).
 *
 * Accepted race (pre-existing, review MINOR 2): provenance is a
 * read-then-write, so a `POST /events` + `schedulingMatchId` that passed its
 * `scheduling` check just BEFORE the claim but inserts just after it falls
 * inside the window and is discarded with the claim's events if that lock-in
 * then dies. Telling it apart would need the claim's event ids recorded.
 *
 * The lower bound compares an app-clock stamp with the DB clock and assumes
 * a UTC session (codebase-wide); the claim → create gap dwarfs any skew.
 */
async function findClaimEvents(
  db: Db,
  claim: PendingLockInClaim,
  releasedAt: string,
): Promise<{ id: number; creatorId: number }[]> {
  return db
    .select({ id: e.id, creatorId: e.creatorId })
    .from(e)
    .where(
      and(
        eq(e.createdFromPollId, claim.matchId),
        gte(e.createdAt, claim.claimedAt),
        sql`${e.createdAt} <= ${releasedAt}::timestamp`,
      ),
    );
}

/** Delete each orphan as its creator with admin rights; log and skip a throw. */
async function discardClaimEvents(
  deps: LockInRecoveryDeps,
  claim: PendingLockInClaim,
  releasedAt: string,
): Promise<number[]> {
  const discarded: number[] = [];
  for (const ev of await findClaimEvents(deps.db, claim, releasedAt)) {
    try {
      await deps.eventsService.delete(ev.id, ev.creatorId, true);
      discarded.push(ev.id);
    } catch (err: unknown) {
      deps.logger.error(
        `Lock-in recovery on match ${claim.matchId}: event ${ev.id} not deleted (manual cleanup needed): ${String(err)}`,
      );
    }
  }
  return discarded;
}

function describeActor(actor: LockInRecoveryActor): string {
  return actor.kind === 'cron' ? 'cron' : `admin #${actor.userId}`;
}

/**
 * Release the claim (token-fenced), then discard its orphaned events and
 * re-render the poll embed. `recovered: false` when the claim had already
 * linked or released — nothing is touched then.
 */
export async function recoverClaim(
  deps: LockInRecoveryDeps,
  claim: PendingLockInClaim,
  actor: LockInRecoveryActor,
): Promise<LockInRecoveryResult> {
  const releasedAt = await releaseRecoveredClaim(deps.db, claim);
  if (releasedAt === null) {
    return { recovered: false, discardedEventIds: [] };
  }
  const discardedEventIds = await discardClaimEvents(deps, claim, releasedAt);
  deps.pollEmbed.fireUpdateEmbed(claim.matchId);
  deps.logger.warn(
    `Recovered lock-in claim on match ${claim.matchId} (claimed ${claim.claimedAt.toISOString()}, by ${describeActor(actor)}), discarded events [${discardedEventIds.join(', ')}]`,
  );
  return { recovered: true, discardedEventIds };
}

/**
 * The poll page's `lockInRecoverable` (ROK-2033): `{ lockInRecoverable: true }`
 * only for an ADMIN viewer on a claimed-and-never-linked poll (the same
 * predicate as `findRecoverableClaim`, any age); `{}` otherwise so the key is
 * omitted under `exactOptionalPropertyTypes`.
 */
export function lockInRecoverableField(
  match: {
    status: string;
    linkedEventId: number | null;
    lockInClaimedAt?: Date | null;
  },
  callerRole: string | null,
): { lockInRecoverable?: true } {
  const recoverable =
    callerRole === 'admin' &&
    match.status === 'scheduled' &&
    match.linkedEventId === null &&
    (match.lockInClaimedAt ?? null) !== null;
  return recoverable ? { lockInRecoverable: true } : {};
}
