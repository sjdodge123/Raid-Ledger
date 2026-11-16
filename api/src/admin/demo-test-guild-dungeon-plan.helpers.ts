/**
 * ROK-2216 — the `withDungeonPlan: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture, for the Dungeon planner tab's
 * Playwright P5 and fleet plan step S4: the guild's faction becomes Alliance
 * and the three claimed characters get Armory completed quests for one
 * listed WoW: Forever dungeon that has a Horde-only quest (so the planner's
 * "N Horde quest hidden" note shows). Reads the dungeon quest data the WoW
 * plugin seeds; never writes `games` or quest rows. Same DEMO_MODE + admin
 * guards as the rest of seed-guild.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import { listInstances } from '../plugins/wow-common/instance-catalogue/instance-catalogue';
import { resolveQuestInstanceIds } from '../plugins/wow-common/forever-instance-aliases';
import { isQuestUsableBySide } from '../plugins/wow-common/quest-faction.helpers';
import { WOW_FOREVER_GAME_SLUG } from '../plugins/wow-common/wow-forever-identity.helpers';
import type { SeedGuildInput } from './demo-test-guild.helpers';
import type { RosterCtx, SeededRoster } from './demo-test-guild.response';

type Db = PostgresJsDatabase<typeof schema>;
type Owner = 'gm' | 'officer' | 'member';
const OWNERS: readonly Owner[] = ['gm', 'officer', 'member'];

/** The guild faction the fixture sets (stored as the Armory writes it). */
export const SEED_PLAN_FACTION = 'Alliance';

/** The dungeon quest columns the picker needs. */
export interface PlanQuestRow {
  questId: number;
  dungeonInstanceId: number | null;
  raceRestriction: string[] | null;
}

/** A catalogue dungeon, as far as the picker cares. */
export interface PlanDungeon {
  id: number;
  name: string;
}

/** One claimed character of the plan fixture. */
export interface SeededPlanCharacter {
  characterId: string;
  memberId: number;
  completedQuestIds: number[];
}

/** The `dungeonPlan` field of the seed-guild response. */
export interface SeededDungeonPlan {
  instanceId: number;
  instanceName: string;
  guildFaction: typeof SEED_PLAN_FACTION;
  /** The Horde-only quest the planner hides (and counts in its note). */
  hiddenQuestId: number;
  /** The dungeon's Alliance-usable quests, ascending. */
  shownQuestIds: number[];
  characters: Record<Owner, SeededPlanCharacter>;
  /** The roster rows with no RL character (the plan link's `m<id>` tokens). */
  unlinkedMemberIds: number[];
  /** `/hubs/:id?d=…&c=<gm>,<officer>,m<unlinked>#dungeon-planner`. */
  planPath: string;
}

/** The chosen dungeon with its hidden and shown quests. */
export interface PickedPlanDungeon {
  instance: PlanDungeon;
  hordeQuestId: number;
  shownQuestIds: number[];
}

/**
 * The first dungeon (catalogue order) with a Horde-only quest and at least
 * one Alliance-usable quest; null when the quest data has none.
 */
export function pickPlanDungeon(
  dungeons: readonly PlanDungeon[],
  quests: readonly PlanQuestRow[],
  resolve: (id: number) => number[] = resolveQuestInstanceIds,
): PickedPlanDungeon | null {
  for (const instance of dungeons) {
    const ids = new Set(resolve(instance.id));
    const own = quests.filter(
      (q) => q.dungeonInstanceId !== null && ids.has(q.dungeonInstanceId),
    );
    const horde = own.find((q) => !isQuestUsableBySide(q, 'alliance'));
    const shown = own
      .filter((q) => isQuestUsableBySide(q, 'alliance'))
      .map((q) => q.questId)
      .sort((a, b) => a - b);
    if (horde && shown.length > 0) {
      return { instance, hordeQuestId: horde.questId, shownQuestIds: shown };
    }
  }
  return null;
}

/** gm: every shown quest but the last; officer: the first; member: none. */
export function planCompletions(
  shown: readonly number[],
): Record<Owner, number[]> {
  return {
    gm: shown.slice(0, Math.max(shown.length - 1, 1)),
    officer: shown.slice(0, 1),
    member: [],
  };
}

/** The listed WoW: Forever dungeons, in catalogue order. */
function foreverDungeons(): PlanDungeon[] {
  return listInstances('wow_forever', 'dungeon');
}

/** `withDungeonPlan`: faction + Armory quests; `{}` when not asked. */
export async function seedDungeonPlanHalf(
  db: Db,
  input: Pick<SeedGuildInput, 'withDungeonPlan' | 'gameSlug'>,
  ctx: Pick<RosterCtx, 'guildId' | 'now'>,
  roster: SeededRoster,
  dungeons: readonly PlanDungeon[] = foreverDungeons(),
  resolve: (id: number) => number[] = resolveQuestInstanceIds,
): Promise<{ dungeonPlan?: SeededDungeonPlan }> {
  if (!input.withDungeonPlan) return {};
  if (input.gameSlug !== WOW_FOREVER_GAME_SLUG) {
    throw new BadRequestException('withDungeonPlan needs a WoW: Forever guild');
  }
  const quests = await loadPlanQuests(
    db,
    dungeons.flatMap((d) => resolve(d.id)),
  );
  const picked = pickPlanDungeon(dungeons, quests, resolve);
  if (!picked) {
    throw new NotFoundException(
      'No listed WoW: Forever dungeon has a Horde-only quest (dungeon quests not seeded?)',
    );
  }
  const characters = planCharacters(
    roster,
    planCompletions(picked.shownQuestIds),
  );
  await writePlan(db, ctx, characters);
  return { dungeonPlan: toSeeded(ctx.guildId, picked, characters, roster) };
}

/** The dungeon quest rows of the given quest-instance ids. */
async function loadPlanQuests(db: Db, ids: number[]): Promise<PlanQuestRow[]> {
  const q = schema.wowClassicDungeonQuests;
  return db
    .select({
      questId: q.questId,
      dungeonInstanceId: q.dungeonInstanceId,
      raceRestriction: q.raceRestriction,
    })
    .from(q)
    .where(inArray(q.dungeonInstanceId, ids));
}

/** The three claimed characters with their completed quests. */
function planCharacters(
  { users }: SeededRoster,
  completed: Record<Owner, number[]>,
): Record<Owner, SeededPlanCharacter> {
  const one = (owner: Owner): SeededPlanCharacter => ({
    characterId: defined(
      users[owner].characterId ?? undefined,
      `seeded ${owner} character`,
    ),
    memberId: defined(
      users[owner].memberId ?? undefined,
      `seeded ${owner} member`,
    ),
    completedQuestIds: completed[owner],
  });
  return { gm: one('gm'), officer: one('officer'), member: one('member') };
}

/** Guild faction, then each character's Armory quests (re-seed overwrites). */
async function writePlan(
  db: Db,
  ctx: Pick<RosterCtx, 'guildId' | 'now'>,
  characters: Record<Owner, SeededPlanCharacter>,
): Promise<void> {
  await db
    .update(schema.guilds)
    .set({ faction: SEED_PLAN_FACTION })
    .where(eq(schema.guilds.id, ctx.guildId));
  const fetchedAt = ctx.now.toISOString();
  for (const owner of OWNERS) {
    const c = characters[owner];
    await db
      .update(schema.characters)
      .set({ armoryQuests: { fetchedAt, completed: c.completedQuestIds } })
      .where(eq(schema.characters.id, c.characterId));
  }
}

/** The response field, incl. the plan link the fleet plan's S2/S4 open. */
function toSeeded(
  guildId: number,
  picked: PickedPlanDungeon,
  characters: Record<Owner, SeededPlanCharacter>,
  { unlinked }: SeededRoster,
): SeededDungeonPlan {
  const unclaimed = defined(unlinked[0], 'seeded unlinked member');
  const tokens = [
    characters.gm.characterId,
    characters.officer.characterId,
    `m${unclaimed}`,
  ];
  return {
    instanceId: picked.instance.id,
    instanceName: picked.instance.name,
    guildFaction: SEED_PLAN_FACTION,
    hiddenQuestId: picked.hordeQuestId,
    shownQuestIds: picked.shownQuestIds,
    characters,
    unlinkedMemberIds: [...unlinked],
    planPath: `/hubs/${guildId}?d=${picked.instance.id}&c=${tokens.join(',')}#dungeon-planner`,
  };
}
