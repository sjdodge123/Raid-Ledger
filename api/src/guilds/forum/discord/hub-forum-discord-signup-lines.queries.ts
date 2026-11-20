/**
 * ROK-2271 — the read behind signup lines: each member's CURRENT
 * line-relevant state for one event (status, roster role / bench, character,
 * running-late (ROK-1379 `running_late_at` + `late_minutes`), roach-out
 * timing (ROK-421 `roached_out_at` vs the event start)), keyed by the real
 * Discord id the line is about. One Drizzle-builder query.
 */
import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { SignupLineState } from './hub-forum-discord-signup-lines';
import { UNKNOWN_MEMBER_NAME } from './hub-forum-discord-signup-lines.copy';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const signups = schema.eventSignups;
const users = schema.users;
const roster = schema.rosterAssignments;
const chars = schema.characters;
const events = schema.events;

/** The roster slot role that means "benched". */
const BENCH_ROLE = 'bench';
const HOUR_MS = 60 * 60 * 1000;
const REAL_DISCORD_ID = /^\d+$/;

/** One member as a line names them, plus their state now. */
export interface SignupLineMember {
  discordId: string;
  displayName: string;
  state: SignupLineState;
}

type Row = Awaited<ReturnType<typeof selectRows>>[number];

function selectRows(db: ForumDiscordDb, where: SQL | undefined) {
  return db
    .select({
      status: signups.status,
      userDiscordId: users.discordId,
      discordUserId: signups.discordUserId,
      displayName: users.displayName,
      username: users.username,
      discordUsername: signups.discordUsername,
      rosterRole: roster.role,
      charName: chars.name,
      charClass: chars.class,
      charSpec: chars.spec,
      runningLateAt: signups.runningLateAt,
      lateMinutes: signups.lateMinutes,
      roachedOutAt: signups.roachedOutAt,
      duration: events.duration,
    })
    .from(signups)
    .innerJoin(events, eq(events.id, signups.eventId))
    .leftJoin(users, eq(users.id, signups.userId))
    .leftJoin(
      roster,
      and(eq(roster.eventId, signups.eventId), eq(roster.signupId, signups.id)),
    )
    .leftJoin(chars, eq(chars.id, signups.characterId))
    .where(where)
    .orderBy(signups.id);
}

/** Hours from the roach-out to the event start (never negative). */
export function roachedHoursBefore(
  start: Date,
  at: Date | null,
): number | null {
  if (at === null) return null;
  return Math.max(0, (start.getTime() - at.getTime()) / HOUR_MS);
}

function toState(row: Row): SignupLineState {
  const bench = row.rosterRole === BENCH_ROLE;
  return {
    status: row.status,
    role: bench ? null : row.rosterRole,
    bench,
    character:
      row.charName === null
        ? null
        : { name: row.charName, className: row.charClass, spec: row.charSpec },
    late: row.runningLateAt !== null,
    lateMinutes: row.lateMinutes,
    roachedHoursBefore: roachedHoursBefore(row.duration[0], row.roachedOutAt),
  };
}

function toMember(row: Row): SignupLineMember | null {
  const discordId = row.userDiscordId ?? row.discordUserId;
  if (discordId === null || !REAL_DISCORD_ID.test(discordId)) return null;
  const displayName =
    row.displayName ??
    row.username ??
    row.discordUsername ??
    UNKNOWN_MEMBER_NAME;
  return { discordId, displayName, state: toState(row) };
}

/**
 * Every signup of `eventId` (any status) whose signer has a real Discord id,
 * keyed by that id. `discordIds` narrows it to those members (an empty list
 * reads nothing). A member absent from the map has no signup row — pass
 * `current: null` for them to the line diff.
 */
export async function loadSignupLineStates(
  db: ForumDiscordDb,
  eventId: number,
  discordIds?: readonly string[],
): Promise<Map<string, SignupLineMember>> {
  if (discordIds !== undefined && discordIds.length === 0) return new Map();
  const ids = discordIds === undefined ? null : [...discordIds];
  const where = and(
    eq(signups.eventId, eventId),
    ids === null
      ? undefined
      : or(inArray(users.discordId, ids), inArray(signups.discordUserId, ids)),
  );
  const out = new Map<string, SignupLineMember>();
  for (const row of await selectRows(db, where)) {
    const member = toMember(row);
    if (member && !out.has(member.discordId)) out.set(member.discordId, member);
  }
  return out;
}
