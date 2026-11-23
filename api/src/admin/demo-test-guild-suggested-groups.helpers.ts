/**
 * ROK-2212 L14 — the `withSuggestedGroup: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture, for the Suggested groups widget's
 * integration spec, Playwright spec and fleet test plan. Inside ONE listed
 * WoW: Forever dungeon's level span (read from the catalogue: the first one
 * below the base roster's level 60, so the five fixed rows stay out of it):
 *
 * - 7 claimed characters across 6 users — 2 tanks, 1 healer, 4 dps, one of
 *   the dps an alt of another dps's owner — each with an empty Armory quest
 *   list (every dungeon quest is "not done");
 * - 3 unclaimed roster rows: a healer and a dps with a verified Armory
 *   snapshot (role + level), and a "dps" with no snapshot → no role →
 *   `pool.skippedNoRole`.
 *
 * The guild faction becomes Alliance (the planner's side rule). Idempotent:
 * every row is keyed on a GUID derived from the guild hash. Same DEMO_MODE +
 * admin guards as the rest of seed-guild.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import { listInstances } from '../plugins/wow-common/instance-catalogue/instance-catalogue';
import { writeMemberSnapshot } from '../plugins/wow-common/forever-armory-snapshot/snapshot.apply';
import { WOW_FOREVER_GAME_SLUG } from '../plugins/wow-common/wow-forever-identity.helpers';
import {
  buildSeedArmorySnapshot,
  seedArmoryBlizzardId,
} from './demo-test-guild-armory.helpers';
import { SEED_PLAN_FACTION } from './demo-test-guild-dungeon-plan.helpers';
import {
  SEED_GUILD_REGION,
  type SeedGuildInput,
} from './demo-test-guild.helpers';
import type { RosterCtx } from './demo-test-guild.response';
import {
  CLAIMED,
  CLASS_OF,
  UNCLAIMED,
  type SeededSgCharacter,
  type SeededSgUnclaimed,
  type SeededSuggestedGroup,
  type SgOwner,
  type SgRole as Role,
  type SgSlot,
  type SgUnclaimed,
} from './demo-test-guild-suggested-groups.cast';

type Db = PostgresJsDatabase<typeof schema>;

/** The fixed roster rows' level (`MEMBER_BASE`); the dungeon must sit below it. */
const BASE_ROSTER_LEVEL = 60;
const SG_RANK = { rankIndex: 4, rankName: 'Initiate' };

interface SgDungeon {
  id: number;
  name: string;
  minimumLevel: number;
  maximumLevel: number;
}

/** The first listed Forever dungeon (catalogue order) wholly below level 60. */
export function pickSgDungeon(
  dungeons: readonly SgDungeon[] = listInstances('wow_forever', 'dungeon'),
): SgDungeon {
  const found = dungeons.find((d) => d.maximumLevel < BASE_ROSTER_LEVEL);
  if (!found) {
    throw new NotFoundException('No listed WoW: Forever dungeon below 60');
  }
  return found;
}

/** A LedgerLink-shaped GUID of its own realm, so it never meets the base rows'. */
export function sgGuid(hash: string, index: number): string {
  const tail = `${hash.slice(0, 6)}${index.toString(16).padStart(2, '0')}`;
  return `Player-2212-${tail.toUpperCase()}`;
}

/** `withSuggestedGroup`: the cast above; `{}` when not asked. */
export async function seedSuggestedGroupHalf(
  db: Db,
  input: Pick<SeedGuildInput, 'withSuggestedGroup' | 'gameSlug'>,
  ctx: RosterCtx,
): Promise<{ suggestedGroup?: SeededSuggestedGroup }> {
  if (!input.withSuggestedGroup) return {};
  if (input.gameSlug !== WOW_FOREVER_GAME_SLUG) {
    throw new BadRequestException(
      'withSuggestedGroup needs a WoW: Forever guild',
    );
  }
  const dungeon = pickSgDungeon();
  const level = dungeon.minimumLevel;
  await setAllianceFaction(db, ctx.guildId);
  const characters = await seedClaimed(db, ctx, level);
  const unclaimed = await seedUnclaimed(db, ctx, level);
  const paths = { hubPath: `/hubs/${ctx.guildId}` };
  return {
    suggestedGroup: {
      instanceId: dungeon.id,
      instanceName: dungeon.name,
      minimumLevel: dungeon.minimumLevel,
      maximumLevel: dungeon.maximumLevel,
      level,
      guildFaction: SEED_PLAN_FACTION,
      characters,
      unclaimed,
      ...paths,
      plannerPath: `${paths.hubPath}#dungeon-planner`,
    },
  };
}

/** The planner's side rule reads the guild faction (as `withDungeonPlan`). */
async function setAllianceFaction(db: Db, guildId: number): Promise<void> {
  await db
    .update(schema.guilds)
    .set({ faction: SEED_PLAN_FACTION })
    .where(eq(schema.guilds.id, guildId));
}

/** The six users and their seven characters, each on its own roster row. */
async function seedClaimed(
  db: Db,
  ctx: RosterCtx,
  level: number,
): Promise<Record<SgSlot, SeededSgCharacter>> {
  const out: Partial<Record<SgSlot, SeededSgCharacter>> = {};
  for (const [index, spec] of CLAIMED.entries()) {
    const user = await upsertSgUser(db, ctx.hash, spec.owner);
    const guid = sgGuid(ctx.hash, index);
    const name = `${spec.char}${ctx.nameSuffix}`;
    const row = { guid, name, level, role: spec.role };
    const memberId = await upsertSgMember(db, ctx, row);
    const characterId = await upsertSgCharacter(db, ctx, {
      ...row,
      userId: user.userId,
      isMain: spec.slot !== 'dps1Alt',
    });
    out[spec.slot] = { ...user, characterId, memberId, name, role: spec.role };
  }
  const one = (slot: SgSlot) => defined(out[slot], `seeded ${slot}`);
  return {
    tank1: one('tank1'),
    tank2: one('tank2'),
    healer: one('healer'),
    dps1: one('dps1'),
    dps1Alt: one('dps1Alt'),
    dps2: one('dps2'),
    dps3: one('dps3'),
  };
}

/** The three owner-less roster rows; only the role-bearing two get a snapshot. */
async function seedUnclaimed(
  db: Db,
  ctx: RosterCtx,
  level: number,
): Promise<Record<SgUnclaimed, SeededSgUnclaimed>> {
  const out: Partial<Record<SgUnclaimed, SeededSgUnclaimed>> = {};
  for (const [index, spec] of UNCLAIMED.entries()) {
    const guid = sgGuid(ctx.hash, CLAIMED.length + index);
    const name = `${spec.char}${ctx.nameSuffix}`;
    const row = { guid, name, level, role: spec.role ?? 'dps' };
    const memberId = await upsertSgMember(db, ctx, row);
    if (spec.role !== null) {
      await snapshotRole(db, memberId, { level, role: spec.role }, ctx.now);
    }
    out[spec.slot] = { memberId, key: `m${memberId}`, name, role: spec.role };
  }
  const one = (slot: SgUnclaimed) => defined(out[slot], `seeded ${slot}`);
  return { healer: one('healer'), dps: one('dps'), noRole: one('noRole') };
}

/** A synthetic onboarded user, keyed on a discord id like the base cast's. */
async function upsertSgUser(
  db: Db,
  hash: string,
  owner: SgOwner,
): Promise<{ userId: number; username: string }> {
  const [row] = await db
    .insert(schema.users)
    .values({
      discordId: `smoke-guild-${hash}-sg-${owner}`,
      username: `guild-${hash}-sg-${owner}`,
      role: 'member',
      onboardingCompletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.users.discordId,
      set: { deactivatedAt: null },
    })
    .returning({ id: schema.users.id, username: schema.users.username });
  const user = defined(row, `seed-guild sg ${owner} user`);
  return { userId: user.id, username: user.username };
}

interface SgRow {
  guid: string;
  name: string;
  level: number;
  role: Role;
}

/** One live roster row on (guild, guid); a re-seed re-stamps level + liveness. */
async function upsertSgMember(
  db: Db,
  ctx: RosterCtx,
  row: SgRow,
): Promise<number> {
  const set = {
    ...SG_RANK,
    level: row.level,
    lastSeenAt: ctx.now,
    ledgerlinkSeenAt: ctx.now,
  };
  const [member] = await db
    .insert(schema.guildMembers)
    .values({
      guildId: ctx.guildId,
      guid: row.guid,
      characterName: row.name,
      class: CLASS_OF[row.role],
      source: 'addon_import',
      ...set,
    })
    .onConflictDoUpdate({
      target: [schema.guildMembers.guildId, schema.guildMembers.guid],
      targetWhere: sql`${schema.guildMembers.guid} IS NOT NULL`,
      set,
    })
    .returning({ id: schema.guildMembers.id });
  return defined(member, `seed-guild sg member ${row.name}`).id;
}

/** Find-or-insert the GUID character for `userId`, with an empty Armory quest list. */
async function upsertSgCharacter(
  db: Db,
  ctx: RosterCtx,
  a: SgRow & { userId: number; isMain: boolean },
): Promise<string> {
  const c = schema.characters;
  const values = {
    userId: a.userId,
    name: a.name,
    class: CLASS_OF[a.role],
    level: a.level,
    role: a.role,
    isMain: a.isMain,
    armoryQuests: { fetchedAt: ctx.now.toISOString(), completed: [] },
  };
  const found = await findSgCharacter(db, ctx.gameId, a.guid);
  if (found) {
    await db.update(c).set(values).where(eq(c.id, found.id));
    return found.id;
  }
  const [row] = await db
    .insert(c)
    .values({
      ...values,
      gameId: ctx.gameId,
      region: SEED_GUILD_REGION,
      addonGuid: a.guid,
    })
    .returning({ id: c.id });
  return defined(row, `seed-guild sg character ${a.name}`).id;
}

/** The seeded character carrying `guid`, if any (re-seed). */
async function findSgCharacter(
  db: Db,
  gameId: number,
  guid: string,
): Promise<{ id: string } | undefined> {
  const c = schema.characters;
  const [found] = await db
    .select({ id: c.id })
    .from(c)
    .where(
      and(
        eq(c.gameId, gameId),
        eq(c.region, SEED_GUILD_REGION),
        eq(c.addonGuid, guid),
      ),
    )
    .limit(1);
  return found;
}

/** A verified roster Armory snapshot carrying the row's role and level. */
async function snapshotRole(
  db: Db,
  memberId: number,
  fact: { level: number; role: Role },
  now: Date,
): Promise<void> {
  const blizzardId = seedArmoryBlizzardId(memberId);
  await db
    .update(schema.guildMembers)
    .set({ blizzardCharacterId: blizzardId })
    .where(eq(schema.guildMembers.id, memberId));
  const base = buildSeedArmorySnapshot(blizzardId, now);
  await writeMemberSnapshot(
    db,
    { memberId, blizzardId, rosterLevel: fact.level },
    { ...base, level: fact.level, role: fact.role, class: CLASS_OF[fact.role] },
    now,
  );
}
