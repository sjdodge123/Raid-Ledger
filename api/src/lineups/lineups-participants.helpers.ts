/**
 * Lineup participant roster helpers (ROK-1346).
 *
 * Builds the deduped participant roster that powers the hero
 * "Participants · N" button + read-only modal across every lineup phase.
 *
 * Roster composition:
 *   - Private lineup: creator (`creator`) + invitees (`invitee`).
 *   - Public lineup: deduped union of creator (`creator`) + nominators
 *     (`participant`) + voters (`participant`).
 *   - Role precedence: creator > invitee > participant.
 *   - Status (phase-agnostic precedence): `voted` if the user cast any vote,
 *     else `nominated` if they nominated any game, else `waiting`.
 *   - Deactivated users (`deactivated_at IS NOT NULL`) are excluded.
 *
 * Ordering is deterministic for tests: creator first, then by role
 * (invitee before participant) then displayName.
 */
import { NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  LineupParticipantDto,
  LineupParticipantsResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { activeUsersFilter } from '../users/users-active.helpers';
import { findLineupById } from './lineups-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

type ParticipantRole = LineupParticipantDto['role'];

/** Role precedence used when a user appears via multiple sources. */
const ROLE_ORDER: Record<ParticipantRole, number> = {
  creator: 0,
  invitee: 1,
  participant: 2,
};

/** Profile columns needed to render a roster row. */
async function loadProfiles(db: Db, userIds: number[]) {
  if (userIds.length === 0) return [];
  return db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      username: schema.users.username,
      avatar: schema.users.avatar,
      customAvatarUrl: schema.users.customAvatarUrl,
      discordId: schema.users.discordId,
      steamId: schema.users.steamId,
    })
    .from(schema.users)
    .where(and(inArray(schema.users.id, userIds), activeUsersFilter()));
}

/** Distinct user IDs that nominated a game in the lineup. */
async function loadNominatorIds(db: Db, lineupId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: schema.communityLineupEntries.nominatedBy })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
  return rows.map((r) => r.userId);
}

/** Distinct user IDs that cast a vote in the lineup. */
async function loadVoterIds(db: Db, lineupId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: schema.communityLineupVotes.userId })
    .from(schema.communityLineupVotes)
    .where(eq(schema.communityLineupVotes.lineupId, lineupId));
  return rows.map((r) => r.userId);
}

/** Distinct invitee user IDs for a private lineup. */
async function loadInviteeIds(db: Db, lineupId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: schema.communityLineupInvitees.userId })
    .from(schema.communityLineupInvitees)
    .where(eq(schema.communityLineupInvitees.lineupId, lineupId));
  return rows.map((r) => r.userId);
}

interface RosterSources {
  creatorId: number;
  inviteeIds: Set<number>;
  nominatorIds: Set<number>;
  voterIds: Set<number>;
}

type ProfileRow = Awaited<ReturnType<typeof loadProfiles>>[number];

/** Assign a role to a user, honoring creator > invitee > participant precedence. */
function deriveRole(userId: number, sources: RosterSources): ParticipantRole {
  if (userId === sources.creatorId) return 'creator';
  if (sources.inviteeIds.has(userId)) return 'invitee';
  return 'participant';
}

/** Derive participation status: voted > nominated > waiting. */
function deriveStatus(
  userId: number,
  sources: RosterSources,
): LineupParticipantDto['status'] {
  if (sources.voterIds.has(userId)) return 'voted';
  if (sources.nominatorIds.has(userId)) return 'nominated';
  return 'waiting';
}

/** Map a profile row + roster sources into a participant DTO. */
function toParticipant(
  p: ProfileRow,
  sources: RosterSources,
): LineupParticipantDto {
  return {
    userId: p.id,
    displayName: p.displayName ?? p.username,
    avatar: p.avatar,
    customAvatarUrl: p.customAvatarUrl,
    discordId: p.discordId,
    role: deriveRole(p.id, sources),
    status: deriveStatus(p.id, sources),
    steamLinked: !!p.steamId,
  };
}

/**
 * Candidate user IDs per visibility. Private = creator + invitees; public =
 * creator + nominators + voters. Deactivated users drop out later when
 * `loadProfiles` filters by `activeUsersFilter`.
 */
function collectCandidateIds(
  isPrivate: boolean,
  sources: RosterSources,
): number[] {
  const candidates = new Set<number>([sources.creatorId]);
  if (isPrivate) {
    sources.inviteeIds.forEach((id) => candidates.add(id));
  } else {
    sources.nominatorIds.forEach((id) => candidates.add(id));
    sources.voterIds.forEach((id) => candidates.add(id));
  }
  return [...candidates];
}

/** Sort roster: creator first, then role, then displayName (deterministic). */
function sortRoster(roster: LineupParticipantDto[]): LineupParticipantDto[] {
  return roster.sort((a, b) => {
    const roleDelta = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    return roleDelta !== 0
      ? roleDelta
      : a.displayName.localeCompare(b.displayName);
  });
}

/** Load the nominator / voter / invitee sets that classify each user. */
async function loadRosterSources(
  db: Db,
  lineupId: number,
  creatorId: number,
  isPrivate: boolean,
): Promise<RosterSources> {
  const [nominatorIds, voterIds, inviteeIds] = await Promise.all([
    loadNominatorIds(db, lineupId),
    loadVoterIds(db, lineupId),
    isPrivate ? loadInviteeIds(db, lineupId) : Promise.resolve<number[]>([]),
  ]);
  return {
    creatorId,
    inviteeIds: new Set(inviteeIds),
    nominatorIds: new Set(nominatorIds),
    voterIds: new Set(voterIds),
  };
}

/**
 * Build the deduped participant roster for a lineup.
 *
 * Read-open: no per-viewer visibility guard (mirrors `findById`). 404 only
 * when the lineup id does not exist.
 */
export async function buildParticipantsRoster(
  db: Db,
  lineupId: number,
): Promise<LineupParticipantDto[]> {
  const [lineup] = await findLineupById(db, lineupId);
  if (!lineup) throw new NotFoundException('Lineup not found');

  const isPrivate = lineup.visibility === 'private';
  const sources = await loadRosterSources(
    db,
    lineupId,
    lineup.createdBy,
    isPrivate,
  );
  const profiles = await loadProfiles(
    db,
    collectCandidateIds(isPrivate, sources),
  );
  return sortRoster(profiles.map((p) => toParticipant(p, sources)));
}

/** Wrap the roster in the response envelope for the service/controller. */
export async function getParticipantsResponse(
  db: Db,
  lineupId: number,
): Promise<LineupParticipantsResponseDto> {
  return { participants: await buildParticipantsRoster(db, lineupId) };
}
