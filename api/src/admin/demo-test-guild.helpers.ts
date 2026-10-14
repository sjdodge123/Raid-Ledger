/**
 * ROK-1785 L6 — helpers for the DEMO_MODE `POST /admin/test/wow/seed-guild`
 * fixture. Every write is an upsert or a find-or-insert keyed on the caller's
 * guild name, so a re-call lands on the same rows (and re-stamps the latest
 * snapshot so every member stays "live").
 *
 * Never inserts into `games`: the WoW game is resolved by slug and a missing
 * row is a 404, not a silent create (CLAUDE.md games-table INSERT guard).
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import { ALL_WOW_GAME_SLUGS } from '../plugins/wow-common/manifest';
import { WOW_FOREVER_GAME_SLUG } from '../plugins/wow-common/wow-forever-identity.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const SEED_GUILD_REGION = 'us';
/** Display realm (`raw_realm`) so the guild hero shows one — identity stays realm-less. */
export const SEED_GUILD_REALM = 'Doomhowl';

/** One seeded user role. `unlinked` has a member row but no RL user. */
export type SeedGuildRole = 'gm' | 'officer' | 'member' | 'outsider';

export interface SeedGuildInput {
  name: string;
  gameSlug: string;
}

/** The five roster rows, rank 0..4; `owner` = the user whose character links. */
export const SEED_GUILD_ROSTER = [
  {
    rank: 0,
    rankName: 'Guild Master',
    char: 'Aldren',
    owner: 'gm',
    role: 'tank',
  },
  {
    rank: 1,
    rankName: 'Officer',
    char: 'Brisa',
    owner: 'officer',
    role: 'healer',
  },
  { rank: 2, rankName: 'Veteran', char: 'Corvin', owner: null, role: null },
  { rank: 3, rankName: 'Member', char: 'Dainel', owner: 'member', role: 'dps' },
  { rank: 4, rankName: 'Initiate', char: 'Elowen', owner: null, role: null },
] as const;

/** The rank the GM delegated page editing to. */
export const SEED_GUILD_EDITOR_RANK = 1;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{2,47}$/;

/** Body → validated input; 400 on a bad name or a non-WoW slug. */
export function parseSeedGuildBody(body: unknown): SeedGuildInput {
  const raw = (body ?? {}) as { name?: unknown; gameSlug?: unknown };
  if (typeof raw.name !== 'string' || !NAME_RE.test(raw.name)) {
    throw new BadRequestException(
      'name: 3-48 chars, letters/digits/space/_/- (starts alphanumeric)',
    );
  }
  const gameSlug = raw.gameSlug ?? WOW_FOREVER_GAME_SLUG;
  if (typeof gameSlug !== 'string' || !ALL_WOW_GAME_SLUGS.includes(gameSlug)) {
    throw new BadRequestException('gameSlug must be a WoW game slug');
  }
  return { name: raw.name, gameSlug };
}

/** Short stable hash of the guild key — keeps GUIDs within varchar(32). */
export function guildKeyHash(nameKey: string): string {
  return createHash('sha1').update(nameKey).digest('hex').slice(0, 12);
}

/** The seeded game id; 404 when the WoW game row is missing. */
export async function findWowGameId(db: Db, slug: string): Promise<number> {
  const [game] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (!game) {
    throw new NotFoundException(`WoW game "${slug}" is not seeded`);
  }
  return game.id;
}

/** Upsert the realm-less guild, re-stamping its snapshot to `now`. */
export async function upsertGuild(
  db: Db,
  gameId: number,
  name: string,
  now: Date,
): Promise<number> {
  const set = {
    memberCount: SEED_GUILD_ROSTER.length,
    rawRealm: SEED_GUILD_REALM,
    lastSnapshotAt: now,
    updatedAt: now,
  };
  const values = { gameId, region: SEED_GUILD_REGION, name, ...set };
  const [row] = await db
    .insert(schema.guilds)
    .values({ ...values, nameKey: name.toLowerCase(), source: 'addon_import' })
    .onConflictDoUpdate({
      target: [
        schema.guilds.gameId,
        schema.guilds.region,
        schema.guilds.nameKey,
      ],
      targetWhere: sql`${schema.guilds.realmSlug} IS NULL`,
      set,
    })
    .returning({ id: schema.guilds.id });
  return defined(row, 'upserted guild').id;
}

/** Upsert one onboarded member user keyed on a synthetic discord_id. */
export async function upsertSeedUser(
  db: Db,
  hash: string,
  role: SeedGuildRole,
): Promise<{ userId: number; username: string; discordId: string }> {
  const discordId = `smoke-guild-${hash}-${role}`;
  const [row] = await db
    .insert(schema.users)
    .values({
      discordId,
      username: `guild-${hash}-${role}`,
      role: 'member',
      onboardingCompletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.users.discordId,
      set: { deactivatedAt: null, onboardingCompletedAt: new Date() },
    })
    .returning({ id: schema.users.id, username: schema.users.username });
  const user = defined(row, `seed-guild ${role} user`);
  return { userId: user.id, username: user.username, discordId };
}

const MEMBER_BASE = { level: 60, class: 'Warrior', source: 'addon_import' };

/** Upsert one roster row on (guild, guid), stamped live at `now`. */
export async function upsertMember(
  db: Db,
  guildId: number,
  entry: (typeof SEED_GUILD_ROSTER)[number],
  guid: string,
  now: Date,
): Promise<number> {
  const set = {
    rankIndex: entry.rank,
    rankName: entry.rankName,
    lastSeenAt: now,
  };
  const [row] = await db
    .insert(schema.guildMembers)
    .values({
      guildId,
      guid,
      characterName: entry.char,
      ...MEMBER_BASE,
      ...set,
    })
    .onConflictDoUpdate({
      target: [schema.guildMembers.guildId, schema.guildMembers.guid],
      targetWhere: sql`${schema.guildMembers.guid} IS NOT NULL`,
      set,
    })
    .returning({ id: schema.guildMembers.id });
  return defined(row, `seed-guild member ${entry.char}`).id;
}

interface SeedCharacterArgs {
  userId: number;
  gameId: number;
  guid: string;
  name: string;
  role: string | null;
}

async function findCharacterId(
  db: Db,
  args: SeedCharacterArgs,
): Promise<string | undefined> {
  const [found] = await db
    .select({ id: schema.characters.id })
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.userId, args.userId),
        eq(schema.characters.gameId, args.gameId),
        eq(schema.characters.addonGuid, args.guid),
      ),
    )
    .limit(1);
  return found?.id;
}

/** Find-or-insert the user's main character carrying the member GUID. */
export async function ensureCharacter(
  db: Db,
  args: SeedCharacterArgs,
): Promise<string> {
  const existing = await findCharacterId(db, args);
  if (existing !== undefined) return existing;
  const [row] = await db
    .insert(schema.characters)
    .values({
      userId: args.userId,
      gameId: args.gameId,
      name: args.name,
      region: SEED_GUILD_REGION,
      class: 'Warrior',
      level: 60,
      role: args.role,
      addonGuid: args.guid,
      isMain: true,
    })
    .returning({ id: schema.characters.id });
  return defined(row, `seed-guild character ${args.name}`).id;
}

/** Idempotent rank grant for the delegated-editor rank. */
export async function ensureRankEditor(
  db: Db,
  guildId: number,
  grantedBy: number,
): Promise<number> {
  await db
    .insert(schema.guildEditors)
    .values({
      guildId,
      kind: 'rank',
      rankIndex: SEED_GUILD_EDITOR_RANK,
      grantedBy,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: schema.guildEditors.id })
    .from(schema.guildEditors)
    .where(
      and(
        eq(schema.guildEditors.guildId, guildId),
        eq(schema.guildEditors.rankIndex, SEED_GUILD_EDITOR_RANK),
      ),
    )
    .limit(1);
  return defined(row, 'seed-guild rank editor').id;
}
