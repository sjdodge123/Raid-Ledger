/**
 * The spawn transaction for LFG "playing now" groups (ROK-1494 D1/D2).
 *
 * Everything here runs inside ONE transaction that holds
 * `pg_advisory_xact_lock(hashtext(lfgGroupLockKey(gameId)))` — the SAME key
 * `LfgService.postUnderGroupLock` takes. `POST /lfg`'s emits are post-COMMIT
 * and therefore OUTSIDE that lock, so whoever spawns has to re-take it; taking
 * it here is what makes "exactly one open now-event per game" exact rather
 * than best-effort under a concurrent third hand.
 *
 * Every statement uses the `tx` handle. Work issued against the outer `db`
 * would run on another connection and fall outside the lock.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { lfgGroupLockKey } from '../../lfg/lfg.constants';
import { convertGroup } from '../../lfg/lfg-write.helpers';
import { autoSignupParticipant } from '../services/ad-hoc-event.signup-helpers';
import { createLfgNowEventRow } from './lfg-now-event.helpers';
import { LFG_NOW_SPAWN_THRESHOLD } from './lfg-now.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** A live `now` hand, with the Discord identity the roster needs. */
export interface LfgNowHand {
  userId: number;
  createdAt: Date;
  discordId: string | null;
  username: string;
  discordAvatarHash: string | null;
}

/** What one pass of the spawn decision settled on. */
export interface LfgNowSpawnResult {
  eventId: number;
  /** True when THIS pass created the event; false when it attached to one. */
  spawned: boolean;
}

/**
 * Live `now` hands on a game, EARLIEST FIRST — `[0]` is AC1's host.
 *
 * Mirrors the read-side liveness predicate (`status = 'active'` and not yet
 * expired) so the roster can never name a holder the visible group had already
 * dropped.
 *
 * @param db - The spawn transaction handle.
 * @param gameId - Game whose group is being decided.
 * @param now - Liveness instant.
 * @returns The hands, ordered by `created_at` ascending.
 */
export async function listLiveNowHands(
  db: Db,
  gameId: number,
  now: Date = new Date(),
): Promise<LfgNowHand[]> {
  return db
    .select({
      userId: schema.lfgIntents.userId,
      createdAt: schema.lfgIntents.createdAt,
      discordId: schema.users.discordId,
      username: schema.users.username,
      discordAvatarHash: schema.users.avatar,
    })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'active'),
        eq(schema.lfgIntents.urgency, 'now'),
        isNull(schema.users.deactivatedAt),
        isNull(schema.users.bannedAt),
        sql`${schema.lfgIntents.expiresAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(schema.lfgIntents.createdAt));
}

/**
 * D2's guard read: the game's OPEN LFG-born event, if one exists.
 *
 * Provenance, not a marker column — an event qualifies only when some
 * `lfg_intents` row already points at it, which is exactly the link the spawn
 * is required to write. Held under the advisory lock this is exact, which is
 * why no DB-level uniqueness (and therefore no migration) is needed (A6).
 *
 * @param db - The spawn transaction handle.
 * @param gameId - Game whose group is being decided.
 * @returns The open event's id, or null.
 */
export async function findOpenLfgNowEvent(
  db: Db,
  gameId: number,
): Promise<number | null> {
  const rows = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .innerJoin(
      schema.lfgIntents,
      eq(schema.lfgIntents.convertedToEventId, schema.events.id),
    )
    .where(
      and(
        eq(schema.events.gameId, gameId),
        eq(schema.events.isAdHoc, true),
        isNull(schema.events.cancelledAt),
        sql`${schema.events.adHocStatus} IN ('live', 'grace_period')`,
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Roster the given hands onto an event.
 *
 * A hand with no linked Discord account is skipped: the roster row is keyed by
 * Discord id, and a member who cannot be in a Discord voice channel cannot be
 * in this session either. Their intent still converts.
 *
 * @param db - The spawn transaction handle.
 * @param eventId - Event to sign them up to.
 * @param hands - Live now-hands.
 */
export async function signupNowHands(
  db: Db,
  eventId: number,
  hands: LfgNowHand[],
): Promise<void> {
  for (const hand of hands) {
    if (!hand.discordId) continue;
    await autoSignupParticipant(db, eventId, {
      discordUserId: hand.discordId,
      discordUsername: hand.username,
      discordAvatarHash: hand.discordAvatarHash,
      userId: hand.userId,
    });
  }
}

/**
 * Decide and, if warranted, perform the spawn — under the group advisory lock.
 *
 * Order matters: the guard read comes FIRST, so a third hand arriving after a
 * spawn (whose `nowCount` is 1, below the threshold) still attaches to the open
 * event instead of falling through to "nothing to do".
 *
 * @param db - Drizzle handle; a transaction is opened here.
 * @param gameId - Game whose group changed.
 * @param now - Decision instant.
 * @returns The event decided on, or null when nothing should happen.
 */
export function spawnUnderGroupLock(
  db: Db,
  gameId: number,
  now: Date = new Date(),
): Promise<LfgNowSpawnResult | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lfgGroupLockKey(gameId)}))`,
    );
    const open = await findOpenLfgNowEvent(tx as unknown as Db, gameId);
    const hands = await listLiveNowHands(tx as unknown as Db, gameId, now);
    if (open !== null) {
      return attachToOpenEvent(tx as unknown as Db, gameId, open, hands);
    }
    if (hands.length < LFG_NOW_SPAWN_THRESHOLD) return null;
    const eventId = await createLfgNowEventRow(
      tx as unknown as Db,
      gameId,
      hands[0].userId,
      now,
    );
    await signupNowHands(tx as unknown as Db, eventId, hands);
    await convertGroup(tx as unknown as Db, gameId, { eventId });
    return { eventId, spawned: true };
  });
}

/**
 * The ATTACH branch: a late hand joins the open session rather than minting a
 * second event. Idempotent — with no live hands it converts zero rows.
 *
 * @param tx - The spawn transaction handle.
 * @param gameId - Game whose group changed.
 * @param eventId - The already-open event.
 * @param hands - Live now-hands to attach.
 * @returns The open event, marked as not newly spawned.
 */
export async function attachToOpenEvent(
  tx: Db,
  gameId: number,
  eventId: number,
  hands: LfgNowHand[],
): Promise<LfgNowSpawnResult> {
  if (hands.length > 0) {
    await signupNowHands(tx, eventId, hands);
    await convertGroup(tx, gameId, { eventId });
  }
  return { eventId, spawned: false };
}
