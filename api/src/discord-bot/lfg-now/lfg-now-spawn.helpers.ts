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
import { defined } from '../../common/defined.helpers';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { openLfgNowEventWhere } from '../../lfg/lfg-playing.helpers';
import { lfgGroupLockKey } from '../../lfg/lfg.constants';
import { convertGroup } from '../../lfg/lfg-write.helpers';
import {
  groupScopeFilter,
  type LfgGroupScope,
} from '../../lfg/lfg-group-scope.helpers';
import {
  buildGroupLockInPatch,
  LFG_FOLD_LOCK_IN,
  type LfgLockInGroup,
} from '../../lfg/lfg-lock-in-group.helpers';
import { autoSignupParticipant } from '../services/ad-hoc-event.signup-helpers';
import { restoreFromGracePeriod } from '../services/ad-hoc-event.helpers';
import { createLfgNowEventRow } from './lfg-now-event.helpers';
import {
  findVoiceSpawnTarget,
  lockGameSpawn,
} from '../services/ad-hoc-game-spawn-lock';
import {
  convertStarterIntent,
  listLiveGroupHands,
  type ManualStart,
  withClearedNowSiblings,
} from './lfg-now-manual-start.helpers';
import { LFG_NOW_SPAWN_THRESHOLD } from './lfg-now.constants';
import {
  deferKeyedSignup,
  isKeyedScope,
  keyedCarryover,
} from './lfg-now-keyed-signup.helpers';
import type { LfgSignupCarryover } from '../../plugins/plugin-host/lfg-grouping.adapter';
import type { LfgNowHand, LfgNowSpawnResult } from './lfg-now-spawn.types';
import { findAnyGroupQuickPlay } from './lfg-now-any-session.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export type { LfgNowHand, LfgNowSpawnResult };

/** Caller-supplied variations on the spawn decision (ROK-1613 AC2). */
export interface LfgNowSpawnOptions {
  /**
   * Present when a PLAYER pressed "start playing now" rather than the group
   * crossing the threshold. One optional argument, deliberately, rather than a
   * sibling function: AC2 forbids a second path that creates *almost* the same
   * event.
   */
  manual?: ManualStart;
  /**
   * ROK-2352: the group this decision is about. Absent = the fold (scope
   * null): every live hand of the game, exactly as before groups existed.
   */
  group?: LfgLockInGroup;
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
 * @param scope - ROK-2352: one group key, or null (default) = the whole game.
 * @returns The hands, ordered by `created_at` ascending.
 */
export async function listLiveNowHands(
  db: Db,
  gameId: number,
  now: Date = new Date(),
  scope: LfgGroupScope = null,
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
        groupScopeFilter(scope),
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
 * @param scope - ROK-2352: only an event that group's hands converted into;
 *   null (default) = any group of the game, as before groups existed.
 * @returns The open event's id, or null.
 */
export async function findOpenLfgNowEvent(
  db: Db,
  gameId: number,
  scope: LfgGroupScope = null,
): Promise<number | null> {
  const open = openLfgNowEventWhere(gameId);
  const rows = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .innerJoin(
      schema.lfgIntents,
      eq(schema.lfgIntents.convertedToEventId, schema.events.id),
    )
    // The predicate itself lives in `lfg/lfg-playing.helpers.ts`, shared with
    // the group page's `readPlayingNow` — one definition of "open LFG-born
    // event", so the guard and the read can never disagree (ROK-1494 D9).
    .where(scope === null ? open : and(open, groupScopeFilter(scope)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * The session a now-group joins (ROK-1888): its open LFG-born event, else the
 * game's live Quick Play from any channel or the game server. ROK-2352: a
 * keyed group (a WoW instance) joins only its OWN LFG-born event — voice
 * "playing now" is game-level and attaches to `''` (spec §3.8).
 */
async function findOpenSession(
  tx: Db,
  gameId: number,
  scope: LfgGroupScope,
): Promise<number | null> {
  const lfgBorn = await findOpenLfgNowEvent(tx, gameId, scope);
  if (lfgBorn !== null) return lfgBorn;
  if (scope !== null && scope !== '') return null;
  // ROK-2352 — the Any group never falls back onto a keyed group's session.
  if (scope === '') return findAnyGroupQuickPlay(tx, gameId);
  return (await findVoiceSpawnTarget(tx, gameId))?.id ?? null;
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
 * @param opts - `manual` when a player pressed the button (ROK-1613).
 * @returns The event decided on, or null when nothing should happen.
 */
export function spawnUnderGroupLock(
  db: Db,
  gameId: number,
  now: Date = new Date(),
  opts: LfgNowSpawnOptions = {},
): Promise<LfgNowSpawnResult | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lfgGroupLockKey(gameId)}))`,
    );
    // ROK-1888: also the per-game Quick Play lock (voice + server spawns take
    // it), so "one live Quick Play per game" holds across every spawn path.
    // Order is always group lock -> game lock; the Quick Play paths never take
    // the group lock, so the two cannot deadlock.
    await lockGameSpawn(tx, gameId);
    const group = opts.group ?? LFG_FOLD_LOCK_IN;
    const open = await findOpenSession(tx, gameId, group.scope);
    // The manual branch shares the lock, the guard read and every insert shape
    // with the threshold path below; what it does NOT share is the now-hand
    // count (AC1) or the creator (spec finding 2).
    if (opts.manual)
      return manualStart(tx, gameId, open, opts.manual, now, group);
    const hands = await listLiveNowHands(tx, gameId, now, group.scope);
    if (open !== null) {
      const carry = isKeyedScope(group.scope)
        ? await keyedCarryover(tx, gameId, group)
        : undefined;
      return attachToOpenEvent(tx, gameId, open, hands, group.scope, carry);
    }
    // ROK-2352 P1-4: a keyed group attaches a late `now` hand to its own
    // session, but only Start now ever creates one (never the threshold).
    if (isKeyedScope(group.scope)) return null;
    if (hands.length < LFG_NOW_SPAWN_THRESHOLD) return null;
    return spawnFromHands(tx, gameId, hands, now, group.scope);
  });
}

/** The THRESHOLD branch: mint the session, roster and convert the hands. */
async function spawnFromHands(
  tx: Db,
  gameId: number,
  hands: LfgNowHand[],
  now: Date,
  scope: LfgGroupScope,
): Promise<LfgNowSpawnResult> {
  const eventId = await createLfgNowEventRow(
    tx,
    gameId,
    defined(hands[0], 'earliest live now-hand').userId,
    now,
  );
  await signupNowHands(tx, eventId, hands);
  await convertGroup(tx, gameId, { eventId }, scope);
  const userIds = hands.map((h) => h.userId);
  return {
    eventId,
    spawned: true,
    invitedUserIds: [],
    ...(await withClearedNowSiblings(tx, gameId, userIds, scope)),
  };
}

/**
 * ROK-1613: a player started the session on demand.
 *
 * The starter is rostered and converted; every OTHER live participant is
 * RETURNED, not signed up — AC4's "the starter is in, the rest are asked". The
 * invites are dispatched by the caller after this transaction commits, because
 * announcing from inside it would announce writes a rollback then discards.
 *
 * @param tx - The spawn transaction handle.
 * @param gameId - Game whose group is starting.
 * @param open - An already-open session to attach to, or null (AC5).
 * @param manual - Who pressed the button.
 * @param now - Decision instant.
 * @param group - ROK-2352: the group starting (fold = the whole game).
 * @returns The session, with the invitees the caller owes a DM.
 */
async function manualStart(
  tx: Db,
  gameId: number,
  open: number | null,
  manual: ManualStart,
  now: Date,
  group: LfgLockInGroup,
): Promise<LfgNowSpawnResult> {
  const participants = await listLiveGroupHands(tx, gameId, now, group.scope);
  const starter = participants.find((p) => p.userId === manual.starterUserId);
  // ROK-1888 m4: joining a Quick Play in grace restores it to live, so hands
  // are never signed up to a session about to end (the expiring grace job's
  // `claimAndEndEvent` only ends a `grace_period` row, so it no-ops).
  const restored = open !== null && (await restoreFromGracePeriod(tx, open));
  // Read before the conversion: the carryover covers the group's live hands.
  const patch = await startNowPatch(tx, gameId, group);
  const eventId =
    open ??
    (await createLfgNowEventRow(tx, gameId, manual.starterUserId, now, {
      patch,
    }));
  const deferred = starter
    ? await rosterHands(tx, eventId, [starter], group.scope, patch?.carryover)
    : {};
  const converted = await convertStarterIntent(
    tx,
    gameId,
    manual.starterUserId,
    { eventId },
    now,
    group.scope,
  );
  const startedIds = converted > 0 ? [manual.starterUserId] : [];
  return {
    eventId,
    spawned: open === null,
    invitedUserIds: participants
      .filter((p) => p.userId !== manual.starterUserId)
      .map((p) => p.userId),
    ...(restored ? { restoredFromGrace: true as const } : {}),
    ...deferred,
    ...(await withClearedNowSiblings(tx, gameId, startedIds, group.scope)),
  };
}

/**
 * ROK-2352 §3.8: a keyed group's Start now gets the lock-in's adapter patch
 * (roster, instance, title). `''` and the fold keep the generic now-session.
 */
function startNowPatch(tx: Db, gameId: number, group: LfgLockInGroup) {
  if (!isKeyedScope(group.scope)) return Promise.resolve(undefined);
  return buildGroupLockInPatch(tx, gameId, group);
}

/**
 * ROK-2352 P1-2: `''` / fold hands go on the generic roster now; a keyed
 * group's are deferred to the role-aware post-COMMIT signup (the result's
 * `keyedSignup`), so they land in the instance's tank/healer/dps slots.
 */
async function rosterHands(
  tx: Db,
  eventId: number,
  hands: LfgNowHand[],
  scope: LfgGroupScope,
  carryover: LfgSignupCarryover | undefined,
): Promise<ReturnType<typeof deferKeyedSignup>> {
  if (isKeyedScope(scope)) return deferKeyedSignup(hands, carryover);
  await signupNowHands(tx, eventId, hands);
  return {};
}

/**
 * The ATTACH branch: a late hand joins the open session rather than minting a
 * second event. Idempotent — with no live hands it converts zero rows.
 *
 * @param tx - The spawn transaction handle.
 * @param gameId - Game whose group changed.
 * @param eventId - The already-open event.
 * @param hands - Live now-hands to attach.
 * @param scope - ROK-2352: the group converting; null (default) = the game.
 * @returns The open event, marked as not newly spawned.
 */
export async function attachToOpenEvent(
  tx: Db,
  gameId: number,
  eventId: number,
  hands: LfgNowHand[],
  scope: LfgGroupScope = null,
  carryover?: LfgSignupCarryover,
): Promise<LfgNowSpawnResult> {
  if (hands.length === 0)
    return { eventId, spawned: false, invitedUserIds: [] };
  // ROK-1888 m4, see manualStart
  const restored = await restoreFromGracePeriod(tx, eventId);
  const deferred = await rosterHands(tx, eventId, hands, scope, carryover);
  await convertGroup(tx, gameId, { eventId }, scope);
  const userIds = hands.map((h) => h.userId);
  return {
    eventId,
    spawned: false,
    invitedUserIds: [],
    ...(restored ? { restoredFromGrace: true as const } : {}),
    ...deferred,
    ...(await withClearedNowSiblings(tx, gameId, userIds, scope)),
  };
}
