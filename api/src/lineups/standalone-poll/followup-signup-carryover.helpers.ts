/**
 * ROK-2320 — a post-event follow-up poll (ROK-1371) carries each voter's
 * character + roles from the ended (source) event onto the event its lock-in
 * creates. Without it every voter landed with no character and, on an MMO
 * roster, no slot.
 *
 * The source event is found through `post_event_followup_sent.match_id`
 * (`findFollowupSourceEventId`). Every source signup counts, whatever its
 * status (operator ruling: the vote for the slot is the signal). A character
 * is carried only while it still exists, is owned by the voter (so
 * `verifyCharacterOwnership` never refuses it) AND belongs to the new event's
 * game; otherwise roles only. The read is an enrichment: a failure degrades
 * to no carryover, never a dropped voter or a failed lock-in.
 */
import type { Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CreateSignupDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { SignupsService } from '../../events/signups.service';
import { findFollowupSourceEventId } from '../scheduling/scheduling-query.helpers';
import type { LfgGroupingRegistry } from '../../lfg/lfg-grouping.helpers';
import {
  loadLfgPollCarryover,
  mergeCarryover,
} from '../../lfg/lfg-poll-carryover.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type CarryRole = NonNullable<CreateSignupDto['preferredRoles']>[number];

const CARRY_ROLES: readonly string[] = ['tank', 'healer', 'dps'];

/** One source-event signup, as read for the carryover. */
export interface SourceSignupRow {
  userId: number | null;
  /** Null when the character is gone or no longer the voter's. */
  characterId: string | null;
  preferredRoles: string[] | null;
  rosterRole: string | null;
  characterRole: string | null;
  characterRoleOverride: string | null;
}

function isCarryRole(role: string | null): role is CarryRole {
  return role !== null && CARRY_ROLES.includes(role);
}

/** Preferred roles, else the roster slot's role, else the character's role. */
function carriedRoles(row: SourceSignupRow): CarryRole[] {
  const preferred = (row.preferredRoles ?? []).filter(isCarryRole);
  if (preferred.length > 0) return [...new Set(preferred)].slice(0, 3);
  if (isCarryRole(row.rosterRole)) return [row.rosterRole];
  const charRole = row.characterRoleOverride ?? row.characterRole;
  return isCarryRole(charRole) ? [charRole] : [];
}

/**
 * The signup dto a source signup carries over, or null when it has neither
 * a usable character nor a role.
 */
export function buildCarryDto(row: SourceSignupRow): CreateSignupDto | null {
  const roles = carriedRoles(row);
  if (!row.characterId && roles.length === 0) return null;
  return {
    ...(row.characterId ? { characterId: row.characterId } : {}),
    ...(roles.length > 0 ? { preferredRoles: roles } : {}),
  };
}

/**
 * The source event's signups for `userIds`, joined to the slot and to the
 * character when it is owned by the voter and of `gameId` (null: none).
 */
function selectSourceSignups(
  db: Db,
  eventId: number,
  gameId: number | null,
  userIds: number[],
): Promise<SourceSignupRow[]> {
  const s = schema.eventSignups;
  const c = schema.characters;
  const sameGame = gameId === null ? sql`false` : eq(c.gameId, gameId);
  return db
    .select({
      userId: s.userId,
      characterId: c.id,
      preferredRoles: s.preferredRoles,
      rosterRole: schema.rosterAssignments.role,
      characterRole: c.role,
      characterRoleOverride: c.roleOverride,
    })
    .from(s)
    .leftJoin(c, and(eq(c.id, s.characterId), eq(c.userId, s.userId), sameGame))
    .leftJoin(
      schema.rosterAssignments,
      and(
        eq(schema.rosterAssignments.signupId, s.id),
        eq(schema.rosterAssignments.eventId, s.eventId),
      ),
    )
    .where(and(eq(s.eventId, eventId), inArray(s.userId, userIds)));
}

/** The (new) event's game, or null when it has none. */
async function findEventGameId(
  db: Db,
  eventId: number,
): Promise<number | null> {
  const [event] = await db
    .select({ gameId: schema.events.gameId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event?.gameId ?? null;
}

/** What the carryover read needs. */
export interface CarryoverDeps {
  db: Db;
  logger: Pick<Logger, 'warn'>;
}

/** The follow-up poll and the NEW event its lock-in created. */
export interface CarryoverTarget {
  matchId: number;
  eventId: number;
}

/** The carryover map; throws on a failed read (the caller degrades). */
async function readCarryover(
  db: Db,
  target: CarryoverTarget,
  userIds: number[],
): Promise<Map<number, CreateSignupDto>> {
  const carryover = new Map<number, CreateSignupDto>();
  const sourceEventId = await findFollowupSourceEventId(db, target.matchId);
  if (sourceEventId === null) return carryover;
  const gameId = await findEventGameId(db, target.eventId);
  const rows = await selectSourceSignups(db, sourceEventId, gameId, userIds);
  for (const row of rows) {
    const dto = buildCarryDto(row);
    if (row.userId !== null && dto) carryover.set(row.userId, dto);
  }
  return carryover;
}

/**
 * Per-user signup dto carried from the follow-up poll's source event. Empty
 * for an ordinary poll (no `post_event_followup_sent` row), for a voter with
 * no usable source signup, and when the read fails (logged): the carryover
 * is an enrichment and must never block a signup.
 */
export async function loadFollowupCarryover(
  deps: CarryoverDeps,
  target: CarryoverTarget,
  userIds: readonly number[],
): Promise<Map<number, CreateSignupDto>> {
  if (userIds.length === 0) return new Map();
  try {
    return await readCarryover(deps.db, target, [...userIds]);
  } catch (err: unknown) {
    deps.logger.warn(
      `Follow-up carryover read failed for match ${target.matchId}; signing up without it: ${String(err)}`,
    );
    return new Map();
  }
}

/** What the creator signup needs. */
export interface CreatorSignupDeps extends CarryoverDeps {
  signupsService: Pick<SignupsService, 'signup'>;
  /** ROK-2352: resolves the LFG grouping adapter for the poll carryover. */
  lfgGrouping?: LfgGroupingRegistry | undefined;
}

/** The creator's carried dto: the follow-up source wins over the LFG hand. */
async function loadCreatorCarryover(
  deps: CreatorSignupDeps,
  matchId: number,
  eventId: number,
  userId: number,
): Promise<CreateSignupDto | undefined> {
  const followup = await loadFollowupCarryover(deps, { matchId, eventId }, [
    userId,
  ]);
  const lfg = await loadLfgPollCarryover(deps, matchId, [userId]);
  return mergeCarryover(lfg, followup).get(userId);
}

/**
 * Sign the lock-in's creator up to every occurrence, with their carried
 * character/roles when the poll is a follow-up. A carried signup that throws
 * is logged and retried once with no dto (today's behaviour), so a stale
 * carryover cannot fail the lock-in. A plain-signup throw propagates.
 */
export async function signUpCreatorWithCarryover(
  deps: CreatorSignupDeps,
  matchId: number,
  eventIds: readonly number[],
  userId: number,
): Promise<void> {
  const [eventId] = eventIds;
  const carried =
    eventId === undefined
      ? undefined
      : await loadCreatorCarryover(deps, matchId, eventId, userId);
  const opts = { skipEndedCheck: true };
  for (const id of eventIds) {
    if (!carried) {
      await deps.signupsService.signup(id, userId, undefined, opts);
      continue;
    }
    try {
      await deps.signupsService.signup(id, userId, carried, opts);
    } catch (err: unknown) {
      deps.logger.warn(
        `Carried creator signup failed on event ${id}; retrying without carryover: ${String(err)}`,
      );
      await deps.signupsService.signup(id, userId, undefined, opts);
    }
  }
}
