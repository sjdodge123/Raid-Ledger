/**
 * ROK-1870 §2.6 — `POST /admin/test/community-hubs/seed` helpers: one game,
 * two active community hubs (6 live members incl. an officer + a ban; 1
 * member), one `proposed` by `demo-member`, one archived. Idempotent: the
 * previous seed's rows (by name on the game) are deleted first. No `games`
 * INSERT — an existing game is reused, so the name-dedup guard is moot.
 */
import { NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '../drizzle/schema';
import {
  hubNameKey,
  insertCommunityHub,
} from '../guilds/community/community-proposals.queries';
import { archiveHub } from '../guilds/community/community-hub.lookup';
import { isLinkedDiscordId } from '../guilds/community/discord-guild-member.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const CommunityHubsSeedSchema = z
  .object({ gameId: z.number().int().positive().optional() })
  .strict();

/** The seed's ids for smoke specs + the fleet plan. */
export interface CommunityHubsSeedResult {
  gameId: number;
  hubIds: { crew: number; solo: number; archived: number };
  leaderUserId: number;
  /** Crew's live non-leaders: `[officer, member×4]`. */
  memberUserIds: number[];
  bannedUserId: number;
  proposalId: number;
}

export const SEED_HUB_NAMES = {
  crew: 'Seed Crew',
  solo: 'Seed Solo',
  proposed: 'Seed Hopefuls',
  archived: 'Seed Old Guard',
} as const;

const BG3_SLUG = 'baldurs-gate-3';

/** The body's game, else BG3, else the lowest-id game; 404 when none. */
export async function resolveSeedGame(
  db: Db,
  gameId?: number,
): Promise<number> {
  const gm = schema.games;
  const where =
    gameId === undefined ? eq(gm.slug, BG3_SLUG) : eq(gm.id, gameId);
  const [hit] = await db.select({ id: gm.id }).from(gm).where(where).limit(1);
  if (hit) return hit.id;
  if (gameId !== undefined) throw new NotFoundException('Game not found');
  const [any] = await db
    .select({ id: gm.id })
    .from(gm)
    .orderBy(asc(gm.id))
    .limit(1);
  if (!any) throw new NotFoundException('No games to seed hubs on');
  return any.id;
}

/** Every user the seed creates or reuses; the index derives its snowflake. */
export const SEED_USERNAMES: readonly string[] = [
  'community-leader',
  'community-officer',
  'community-member-1',
  'community-member-2',
  'community-member-3',
  'community-member-4',
  'community-banned',
  'community-solo',
  'demo-member',
];

/** Offset that keeps the synthetic ids clear of the integration specs' `91…`. */
const SEED_SNOWFLAKE_BASE = 1870_000;

/**
 * A unique synthetic Discord snowflake (`9` + 17 digits) for a seed user, so
 * the A2 gate (`isInDiscordGuild`) admits them — a `local:` placeholder does
 * not (OQ-6). Throws for a username outside `SEED_USERNAMES`.
 */
export function seedDiscordId(username: string): string {
  const index = SEED_USERNAMES.indexOf(username);
  if (index < 0) throw new Error(`${username} is not a seed user`);
  return `9${String(SEED_SNOWFLAKE_BASE + index).padStart(17, '0')}`;
}

/** Re-arm an existing user: seen now, active, a placeholder id replaced. */
async function refreshSeedUser(
  db: Db,
  hit: { id: number; discordId: string | null },
  username: string,
): Promise<void> {
  const linked = isLinkedDiscordId(hit.discordId);
  await db
    .update(schema.users)
    .set({
      guildMemberSeenAt: new Date(),
      deactivatedAt: null,
      ...(linked ? {} : { discordId: seedDiscordId(username) }),
    })
    .where(eq(schema.users.id, hit.id));
}

/**
 * A user by username, created A2-eligible (synthetic snowflake, seen in the
 * Discord guild) if absent; an existing user keeps its role and real link.
 */
export async function ensureSeedUser(
  db: Db,
  username: string,
): Promise<number> {
  const u = schema.users;
  const [hit] = await db
    .select({ id: u.id, discordId: u.discordId })
    .from(u)
    .where(eq(u.username, username))
    .limit(1);
  if (hit) {
    await refreshSeedUser(db, hit, username);
    return hit.id;
  }
  const [row] = await db
    .insert(u)
    .values({
      username,
      discordId: seedDiscordId(username),
      role: 'member',
      guildMemberSeenAt: new Date(),
    })
    .returning({ id: u.id });
  if (!row) throw new Error(`seed user ${username} insert returned no row`);
  return row.id;
}

/** Delete the previous seed's hubs on the game (members cascade). */
export async function clearSeedHubs(db: Db, gameId: number): Promise<void> {
  const g = schema.guilds;
  const keys = Object.values(SEED_HUB_NAMES).map(hubNameKey);
  await db
    .delete(g)
    .where(
      and(
        eq(g.kind, 'game_community'),
        eq(g.gameId, gameId),
        inArray(g.nameKey, keys),
      ),
    );
}

/** Insert an active hub led by `leaderId`. */
export async function seedActiveHub(
  db: Db,
  gameId: number,
  name: string,
  leaderId: number,
): Promise<number> {
  const hub = await insertCommunityHub(db, {
    gameId,
    name,
    blurb: `${name} — a seeded community hub.`,
    status: 'active',
    proposedBy: leaderId,
    reviewedBy: null,
  });
  await db
    .insert(schema.hubCommunityMembers)
    .values({ guildId: hub.id, userId: leaderId, role: 'leader' });
  return hub.id;
}

/** The `proposed` hub by `demo-member`. */
export async function seedProposal(
  db: Db,
  gameId: number,
  proposerId: number,
): Promise<number> {
  const hub = await insertCommunityHub(db, {
    gameId,
    name: SEED_HUB_NAMES.proposed,
    blurb: 'A seeded proposal waiting for review.',
    status: 'proposed',
    proposedBy: proposerId,
    reviewedBy: null,
  });
  return hub.id;
}

/** An archived hub (archived by an admin). */
export async function seedArchivedHub(
  db: Db,
  gameId: number,
  leaderId: number,
): Promise<number> {
  const id = await seedActiveHub(db, gameId, SEED_HUB_NAMES.archived, leaderId);
  await archiveHub(db, id, 'admin');
  return id;
}
