/**
 * ROK-1870 §2.6 — the community-hubs seed's self-reset, so a re-POST (a second
 * smoke run against the same env) starts from a clean fixture:
 *
 * - every community hub on the game named like a seed hub, proposed by a seed
 *   user (pending proposals included) or led by one is deleted, with its
 *   `hub_community_members` rows (bans live there too) and the seed users'
 *   `hub_proposal_*` notices about it. Scoped to the game, so parallel smoke
 *   projects seeding other games never clear each other.
 * - seed users are reused, never recreated or deactivated (live sessions
 *   survive), and their Discord DMs are muted: a synthetic snowflake DM fails
 *   with 10013 and the DM classifier would deactivate the user.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  DEFAULT_CHANNEL_PREFS,
  NOTIFICATION_TYPES,
  type ChannelPrefs,
} from '../drizzle/schema/notification-preferences';
import { hubNameKey } from '../guilds/community/community-proposals.queries';
import {
  SEED_HUB_NAMES,
  SEED_USERNAMES,
  ensureSeedUser,
} from './demo-test-community-hubs.helpers';

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

/** Community hubs on the game that belong to the seed fixture. */
export async function findSeedFixtureHubs(
  db: Db,
  gameId: number,
  userIds: number[],
): Promise<number[]> {
  const g = schema.guilds;
  const m = schema.hubCommunityMembers;
  const onGame = and(eq(g.kind, 'game_community'), eq(g.gameId, gameId));
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

/** Delete the fixture hubs + their members, bans and notices; returns ids. */
export async function resetSeedFixture(
  db: Db,
  gameId: number,
  userIds: number[],
): Promise<number[]> {
  const ids = await findSeedFixtureHubs(db, gameId, userIds);
  if (ids.length === 0) return ids;
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
