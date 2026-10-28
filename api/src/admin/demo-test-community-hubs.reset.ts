/**
 * ROK-1870 §2.6 — the community-hubs seed's self-reset, so a re-POST (a second
 * smoke run against the same env) starts from a clean fixture:
 *
 * - every community hub on the game named like a seed hub, proposed by a seed
 *   user (pending proposals included) or led by one is deleted, with its
 *   `hub_community_members` rows (bans live there too) and the seed users'
 *   `hub_proposal_*` notices about it. Scoped to the game, so parallel smoke
 *   projects seeding other games never clear each other.
 * - ROK-2030: with a `tag`, ONLY that tag's hubs (by tagged name, or by a
 *   blurb carrying the tag after a rename) and their hub events are cleared,
 *   so concurrent specs sharing a game never clear each other; untagged, the
 *   sweep above skips every tagged hub.
 * - seed users are reused, never recreated or deactivated (live sessions
 *   survive), and their Discord DMs are muted: a synthetic snowflake DM fails
 *   with 10013 and the DM classifier would deactivate the user.
 */
import { and, eq, inArray, isNull, like, notLike, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  DEFAULT_CHANNEL_PREFS,
  NOTIFICATION_TYPES,
  type ChannelPrefs,
} from '../drizzle/schema/notification-preferences';
import { hubNameKey } from '../guilds/community/community-proposals.queries';
import {
  HUB_EVENT_PREFIX,
  SEED_HUB_NAMES,
  SEED_USERNAMES,
  ensureSeedUser,
} from './demo-test-community-hubs.helpers';
import {
  TAGGED_BLURB_LIKE,
  TAGGED_NAME_LIKE,
  seedHubNames,
  taggedBlurbLike,
} from './demo-test-community-hubs.tag';

type Db = PostgresJsDatabase<typeof schema>;

const SEED_NOTICE_TYPES = [
  'hub_proposal_submitted',
  'hub_proposal_reviewed',
] as const;

/** Every seed user's id (reused when present), in `SEED_USERNAMES` order. */
export async function ensureSeedUsers(db: Db): Promise<number[]> {
  const ids: number[] = [];
  for (const username of SEED_USERNAMES) {
    ids.push(await ensureSeedUser(db, username));
  }
  return ids;
}

/** The default matrix with every Discord channel off. */
export function seedChannelPrefs(): ChannelPrefs {
  const prefs: ChannelPrefs = { ...DEFAULT_CHANNEL_PREFS };
  for (const type of NOTIFICATION_TYPES) {
    prefs[type] = { ...DEFAULT_CHANNEL_PREFS[type], discord: false };
  }
  return prefs;
}

/** Mute Discord DMs for the seed users (their snowflakes are synthetic). */
export async function muteSeedDiscordDms(
  db: Db,
  userIds: number[],
): Promise<void> {
  const t = schema.userNotificationPreferences;
  const channelPrefs = seedChannelPrefs();
  await db
    .insert(t)
    .values(userIds.map((userId) => ({ userId, channelPrefs })))
    .onConflictDoUpdate({ target: t.userId, set: { channelPrefs } });
}

const g = schema.guilds;

/** Hubs no tagged seed created (plain name, no tagged blurb). */
const untaggedOnly = () =>
  and(
    notLike(g.name, TAGGED_NAME_LIKE),
    or(isNull(g.blurb), notLike(g.blurb, TAGGED_BLURB_LIKE)),
  );

/** `tag`'s community hubs on the game: by tagged name or tagged blurb. */
async function findTaggedHubs(
  db: Db,
  gameId: number,
  tag: string,
): Promise<number[]> {
  const n = seedHubNames(tag);
  const keys = [n.crew, n.solo, n.proposed, n.archived].map(hubNameKey);
  const rows = await db
    .select({ id: g.id })
    .from(g)
    .where(
      and(
        eq(g.kind, 'game_community'),
        eq(g.gameId, gameId),
        or(inArray(g.nameKey, keys), like(g.blurb, taggedBlurbLike(tag))),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Community hubs on the game that belong to the seed fixture: `tag`'s hubs
 * only when tagged, else every untagged hub named like a seed hub, proposed
 * or led by a seed user.
 */
export async function findSeedFixtureHubs(
  db: Db,
  gameId: number,
  userIds: number[],
  tag?: string,
): Promise<number[]> {
  if (tag !== undefined) return findTaggedHubs(db, gameId, tag);
  const m = schema.hubCommunityMembers;
  const onGame = and(
    eq(g.kind, 'game_community'),
    eq(g.gameId, gameId),
    untaggedOnly(),
  );
  const keys = Object.values(SEED_HUB_NAMES).map(hubNameKey);
  const owned = await db
    .select({ id: g.id })
    .from(g)
    .where(
      and(onGame, or(inArray(g.nameKey, keys), inArray(g.proposedBy, userIds))),
    );
  const led = await db
    .select({ id: m.guildId })
    .from(m)
    .innerJoin(g, eq(g.id, m.guildId))
    .where(and(onGame, eq(m.role, 'leader'), inArray(m.userId, userIds)));
  return [...new Set([...owned, ...led].map((r) => r.id))];
}

/** A tagged reset's hub events (an untagged seed sweeps orphans instead). */
async function deleteHubEvents(db: Db, hubIds: number[]): Promise<void> {
  const ev = schema.events;
  await db
    .delete(ev)
    .where(
      and(inArray(ev.guildId, hubIds), like(ev.title, `${HUB_EVENT_PREFIX}%`)),
    );
}

/** Delete the fixture hubs + their members, bans and notices; returns ids. */
export async function resetSeedFixture(
  db: Db,
  gameId: number,
  userIds: number[],
  tag?: string,
): Promise<number[]> {
  const ids = await findSeedFixtureHubs(db, gameId, userIds, tag);
  if (ids.length === 0) return ids;
  if (tag !== undefined) await deleteHubEvents(db, ids);
  const n = schema.notifications;
  const hubOf = sql<number>`(${n.payload}->>'guildId')::int`;
  await db
    .delete(n)
    .where(
      and(
        inArray(n.userId, userIds),
        inArray(n.type, [...SEED_NOTICE_TYPES]),
        inArray(hubOf, ids),
      ),
    );
  await db
    .delete(schema.hubCommunityMembers)
    .where(inArray(schema.hubCommunityMembers.guildId, ids));
  await db.delete(schema.guilds).where(inArray(schema.guilds.id, ids));
  return ids;
}
