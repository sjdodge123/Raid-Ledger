/**
 * ROK-1933 L1 — data for the suggested-claim DM scan (spec Part 3, D5).
 * `findUnclaimedSightings` lists unclaimed characters a Steam-only player has
 * been playing in a live Quick Play for a while; `findClaimCandidates` lists
 * the users who might own one. The pure pick is `pickClaimCandidate`.
 * Not-me suppression and the DM dedupe live in Redis keys (D8, L2), not here.
 */
import {
  and,
  asc,
  eq,
  exists,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import { serverHubMemberPredicate } from '../../../pelican/hub/server-hub-membership.helpers';
import type { ClaimCandidate } from './valheim-claim-suggest.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const ap = schema.adHocParticipants;
const p = schema.valheimProfiles;
const u = schema.users;

/** A player must be on the server this long before anyone is asked (Q6). */
export const CLAIM_SUGGEST_MIN_AGE_MS = 10 * 60_000;

/** One unclaimed character being played in a live Quick Play. */
export interface ClaimSighting {
  /** The live Quick Play (ad-hoc event) the player is in. */
  eventId: number;
  /** The server hub (`guilds.kind = 'game_server'`) — the DM's link target. */
  guildId: number;
  pelicanServerId: number;
  profileId: number;
  /** The SteamID64 the mod asserted for the character. */
  steamId: string;
  characterName: string;
}

const e = schema.events;
const g = schema.guilds;

/** A live Quick Play (ad-hoc event). */
const liveQuickPlay = () =>
  and(eq(e.id, ap.eventId), eq(e.isAdHoc, true), eq(e.adHocStatus, 'live'));

/** The unclaimed profile on this server with this SteamID64 and name. */
const unclaimedProfile = () =>
  and(
    eq(p.pelicanServerId, ap.pelicanServerId),
    eq(p.steamId, ap.steamId),
    eq(p.name, ap.characterName),
    isNull(p.claimedBy),
  );

/** The server's visible hub. */
const visibleServerHub = () =>
  and(
    eq(g.pelicanServerId, p.pelicanServerId),
    eq(g.kind, 'game_server'),
    isNull(g.hiddenAt),
  );

/**
 * Unclaimed characters on a visible server hub whose Steam-only player
 * (`user_id IS NULL`) is on the server in a live Quick Play, first seen at
 * least `minAgeMs` before `now`. Matches the profile on server + SteamID64 +
 * exact character name.
 */
export async function findUnclaimedSightings(
  db: Db,
  now: Date,
  minAgeMs: number = CLAIM_SUGGEST_MIN_AGE_MS,
): Promise<ClaimSighting[]> {
  const cutoff = new Date(now.getTime() - minAgeMs);
  return db
    .selectDistinct({
      eventId: ap.eventId,
      guildId: g.id,
      pelicanServerId: p.pelicanServerId,
      profileId: p.id,
      steamId: p.steamId,
      characterName: p.name,
    })
    .from(ap)
    .innerJoin(e, liveQuickPlay())
    .innerJoin(p, unclaimedProfile())
    .innerJoin(g, visibleServerHub())
    .where(
      and(eq(ap.onServer, true), isNull(ap.userId), lte(ap.joinedAt, cutoff)),
    )
    .orderBy(asc(p.id), asc(ap.eventId));
}

/** `u` is a current member of the hub (ROK-1831 L-2 window). */
function hubMember(db: Db, guildId: number, now: Date) {
  const m = schema.hubServerMembers;
  return exists(
    db
      .select({ one: sql`1` })
      .from(m)
      .where(
        and(
          eq(m.guildId, guildId),
          eq(m.userId, u.id),
          serverHubMemberPredicate(now),
        ),
      ),
  );
}

/** `u` owns no character on this server. */
function noClaimHere(db: Db, pelicanServerId: number) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(p)
      .where(
        and(eq(p.pelicanServerId, pelicanServerId), eq(p.claimedBy, u.id)),
      ),
  );
}

/** The voice name of `u` in the Quick Play's voice channel right now, else NULL. */
function voiceName(eventId: number) {
  return sql<string | null>`(SELECT ${ap.discordUsername} FROM ${ap}
    WHERE ${ap.eventId} = ${eventId} AND ${ap.userId} = ${u.id} AND ${ap.inVoice}
    LIMIT 1)`;
}

/**
 * Likely owners of `s`: active users with a Discord id who are a hub member
 * or in the Quick Play's voice, own no character on this server, and whose
 * verified Steam (if any) is the character's (D6). Ordered by user id.
 */
export async function findClaimCandidates(
  db: Db,
  s: ClaimSighting,
  now: Date,
): Promise<ClaimCandidate[]> {
  const voice = voiceName(s.eventId);
  const rows = await db
    .select({
      userId: u.id,
      username: u.username,
      displayName: u.displayName,
      steamId: u.steamId,
      voiceName: voice,
    })
    .from(u)
    .where(
      and(
        isNotNull(u.discordId),
        isNull(u.deactivatedAt),
        or(hubMember(db, s.guildId, now), sql`${voice} IS NOT NULL`),
        noClaimHere(db, s.pelicanServerId),
        or(isNull(u.steamId), eq(u.steamId, s.steamId)),
      ),
    )
    .orderBy(asc(u.id));
  return rows.map(toCandidate);
}

/** Collapse a row's names (deduped, nulls dropped) into a matcher candidate. */
function toCandidate(r: {
  userId: number;
  username: string;
  displayName: string | null;
  steamId: string | null;
  voiceName: string | null;
}): ClaimCandidate {
  const names = [r.username, r.displayName, r.voiceName].filter(
    (n): n is string => n !== null && n !== '',
  );
  return {
    userId: r.userId,
    names: [...new Set(names)],
    inVoice: r.voiceName !== null,
    steamId: r.steamId,
  };
}
