/**
 * ROK-1789 B9 — the seed-guild showcase cast:
 *   - `memberCount`: filler roster rows padding the fixed five to N — roster
 *     only (no RL user), a 2nd officer at rank 1 then ranks 2..4, mixed
 *     Classic classes, levels 40..60;
 *   - `asCaller` (Q-B16): the JWT caller owns the rank-0 row's GUID-linked
 *     character (claimed from the synthetic `gm` user on a re-seed) and gets
 *     a member editor grant.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { NotFoundException } from '@nestjs/common';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import { SEED_GUILD_REGION } from './demo-test-guild.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const CLASSES = [
  'Warrior',
  'Paladin',
  'Hunter',
  'Rogue',
  'Priest',
  'Shaman',
  'Mage',
  'Warlock',
  'Druid',
] as const;
const RANK_NAMES = ['Guild Master', 'Officer', 'Veteran', 'Member', 'Initiate'];

export interface FillerEntry {
  /** 1-based filler number — part of the GUID and the name. */
  n: number;
  char: string;
  rank: number;
  rankName: string;
  class: string;
  level: number;
}

/** `count` filler rows: #1 is the 2nd officer, the rest cycle ranks 2..4 (pure). */
export function fillerRosterEntries(count: number, suffix = ''): FillerEntry[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const rank = i === 0 ? 1 : 2 + (i % 3);
    return {
      n: i + 1,
      char: `Filler${String.fromCharCode(97 + (i % 26))}${i + 1}${suffix}`,
      rank,
      rankName: RANK_NAMES[rank] ?? 'Member',
      class: CLASSES[i % CLASSES.length] ?? 'Warrior',
      level: i % 4 === 0 ? 60 : 40 + ((i * 7) % 21),
    };
  });
}

/** A filler GUID in the LedgerLink shape — `F` + 2 hex of the number keeps it apart from the rank GUIDs. */
export function seedFillerGuid(hash: string, n: number): string {
  const tail = `${hash.slice(0, 5)}F${n.toString(16).padStart(2, '0')}`;
  return `Player-4395-${tail.toUpperCase()}`;
}

type FillerCtx = {
  guildId: number;
  hash: string;
  now: Date;
  nameSuffix: string;
};

/** Upserts one filler row on (guild, guid); returns its member id. */
async function upsertFiller(
  db: Db,
  ctx: FillerCtx,
  e: FillerEntry,
): Promise<number> {
  const m = schema.guildMembers;
  const set = {
    rankIndex: e.rank,
    rankName: e.rankName,
    level: e.level,
    class: e.class,
    lastSeenAt: ctx.now,
  };
  const guid = seedFillerGuid(ctx.hash, e.n);
  const [row] = await db
    .insert(m)
    .values({
      guildId: ctx.guildId,
      guid,
      characterName: e.char,
      source: 'addon_import',
      ...set,
    })
    .onConflictDoUpdate({
      target: [m.guildId, m.guid],
      targetWhere: sql`${m.guid} IS NOT NULL`,
      set,
    })
    .returning({ id: m.id });
  return defined(row, `seed-guild filler ${e.char}`).id;
}

/** Upserts the filler rows; returns their member ids in order. */
export async function seedFillerMembers(
  db: Db,
  ctx: FillerCtx,
  count: number,
): Promise<number[]> {
  const ids: number[] = [];
  for (const e of fillerRosterEntries(count, ctx.nameSuffix)) {
    ids.push(await upsertFiller(db, ctx, e));
  }
  return ids;
}

export interface SeedCaller {
  userId: number;
  username: string;
  discordId: string;
}

/** The JWT caller's user row (404 if it vanished). `discordId` is '' for a local-only user. */
export async function loadSeedCaller(
  db: Db,
  userId: number,
): Promise<SeedCaller> {
  const [row] = await db
    .select({
      username: schema.users.username,
      discordId: schema.users.discordId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) throw new NotFoundException('seed-guild caller not found');
  return { userId, username: row.username, discordId: row.discordId ?? '' };
}

interface ClaimArgs {
  userId: number;
  gameId: number;
  guid: string;
  name: string;
  role: string | null;
}

/**
 * The caller's character on the GUID: re-owns an existing row (one GUID ↔ one
 * RL character, idx_characters_addon_guid) or inserts a non-main one, so the
 * caller's own main is never displaced.
 */
export async function claimGuidCharacter(
  db: Db,
  args: ClaimArgs,
): Promise<string> {
  const found = await reownGuidCharacter(db, args);
  if (found !== undefined) return found;
  const c = schema.characters;
  const [row] = await db
    .insert(c)
    .values({
      userId: args.userId,
      gameId: args.gameId,
      name: args.name,
      role: args.role,
      region: SEED_GUILD_REGION,
      class: 'Warrior',
      level: 60,
      addonGuid: args.guid,
      isMain: false,
    })
    .returning({ id: c.id });
  return defined(row, `seed-guild caller character ${args.name}`).id;
}

/** Moves the GUID's existing character (if any) to the caller, as a non-main. */
async function reownGuidCharacter(
  db: Db,
  args: ClaimArgs,
): Promise<string | undefined> {
  const c = schema.characters;
  const [found] = await db
    .update(c)
    .set({ userId: args.userId, isMain: false, updatedAt: new Date() })
    .where(
      and(
        eq(c.gameId, args.gameId),
        eq(c.region, SEED_GUILD_REGION),
        eq(c.addonGuid, args.guid),
      ),
    )
    .returning({ id: c.id });
  return found?.id;
}

/** Idempotent member editor grant on the caller's rank-0 row ("GM + editor"). */
export async function ensureMemberEditor(
  db: Db,
  guildId: number,
  guildMemberId: number,
  grantedBy: number,
): Promise<void> {
  await db
    .insert(schema.guildEditors)
    .values({ guildId, kind: 'member', guildMemberId, grantedBy })
    .onConflictDoNothing();
}
