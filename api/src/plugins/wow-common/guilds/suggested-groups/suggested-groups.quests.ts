import {
  SUGGESTED_GROUPS_TOP_COUNT,
  type EventQuestReadinessDto,
  type SuggestedGroupDto,
} from '@raid-ledger/contract';
import type { DungeonQuestDto } from '../../dungeon-quests.types';
import {
  contentInstanceIds,
  selectEventQuests,
} from '../../event-forever-progress.helpers';
import {
  buildQuestReadiness,
  type ReadinessSignup,
} from '../../event-quest-readiness.helpers';
import type { EffectiveQuests } from '../../forever-quest-source.helpers';
import {
  filterQuestSetBySide,
  resolvePlanSide,
  type PlanQuestSet,
} from '../dungeon-plan/dungeon-plan.helpers';
import { rankGroups } from './suggested-groups.helpers';

/**
 * ROK-2212 (L7/L7b) — "shared quests" of a suggested group: the dungeon's
 * quests on the guild's side (ROK-2214's side rule) that at least 3 of the 5
 * have not done (`have` or `missing`). Reuses the dungeon planner's readiness
 * builder; unclaimed members have no quest data and never count.
 */

/** Members that must still need a quest for it to count as shared. */
export const SHARED_QUEST_MIN_MEMBERS = 3;

const NOT_DONE: ReadonlySet<string> = new Set(['have', 'missing']);

/** Everything the count needs, loaded once for every scored group. */
export interface SharedQuestContext {
  /** Every known quest (the overlaid list `loadEventQuestSet` reads). */
  known: DungeonQuestDto[];
  /** The hub's faction column (ROK-2214 L7: wins over the characters'). */
  guildFaction: string | null;
  /** Owned claimed characters' readiness rows, by character id. */
  signups: ReadonlyMap<string, ReadinessSignup>;
  /** Effective quest data per character id. */
  snapshots: Map<string, EffectiveQuests>;
}

/** The groups that get a quest count: the top `n` of each dungeon's ranked list. */
export function scoredGroups(
  perDungeon: readonly (readonly SuggestedGroupDto[])[],
  n: number = SUGGESTED_GROUPS_TOP_COUNT,
): SuggestedGroupDto[] {
  return perDungeon.flatMap((groups) => groups.slice(0, n));
}

/** Distinct claimed character ids of `groups` (unclaimed members skipped). */
export function claimedCharacterIds(
  groups: readonly SuggestedGroupDto[],
): string[] {
  const ids = groups.flatMap((g) =>
    g.members.flatMap((m) => m.characterId ?? []),
  );
  return [...new Set(ids)];
}

/** One dungeon's quest set, as `loadEventQuestSet` builds it for an event. */
export function questSetFor(
  known: DungeonQuestDto[],
  instanceId: number,
): PlanQuestSet {
  return selectEventQuests(known, contentInstanceIds([{ id: instanceId }]));
}

/** Count of quests at least {@link SHARED_QUEST_MIN_MEMBERS} members still need. */
export function countShared(readiness: EventQuestReadinessDto): number {
  return readiness.quests.filter((q) => {
    const needing = readiness.signups.filter((s) =>
      s.perQuest.some((p) => p.questId === q.questId && NOT_DONE.has(p.state)),
    );
    return needing.length >= SHARED_QUEST_MIN_MEMBERS;
  }).length;
}

/** L7: the group's shared-quest count (claimed, owned members only — L7b). */
export function sharedQuestCount(
  group: SuggestedGroupDto,
  questSet: PlanQuestSet,
  ctx: SharedQuestContext,
): number {
  const signups = group.members.flatMap((m) =>
    m.characterId === null ? [] : (ctx.signups.get(m.characterId) ?? []),
  );
  const { side } = resolvePlanSide(ctx.guildFaction, signups);
  const filtered = filterQuestSetBySide(questSet, side).questSet;
  const readiness = buildQuestReadiness(
    { quests: filtered, signups, snapshots: ctx.snapshots, manual: [] },
    { side },
  );
  return countShared(readiness);
}

/**
 * Fill `sharedQuests` on the top `n` of each dungeon's list, then re-rank it
 * (the count is the second ranking key, so it can reorder the top).
 */
export function applySharedQuests(
  perDungeon: readonly (readonly SuggestedGroupDto[])[],
  ctx: SharedQuestContext,
  n: number = SUGGESTED_GROUPS_TOP_COUNT,
): SuggestedGroupDto[][] {
  return perDungeon.map((groups) => {
    const first = groups[0];
    if (first === undefined) return [];
    const questSet = questSetFor(ctx.known, first.instance.id);
    const scored = groups.map((g, i) =>
      i < n ? { ...g, sharedQuests: sharedQuestCount(g, questSet, ctx) } : g,
    );
    return rankGroups(scored);
  });
}
