/**
 * ROK-2211: the hub readiness matrix's quest columns. A guild is always
 * single-faction, so when the roster shares a side the columns keep only the
 * quests that side can take (neutral quests always stay), and same-name
 * faction variants collapse into ONE logical column. A roster whose sides
 * disagree or are all unknown keeps every quest, one column each (pre-2211).
 */
import type { DungeonQuestDto } from './dungeon-quests.types';
import { isQuestUsableBySide, type FactionSide } from './quest-faction.helpers';

/** One column: the quest it shows and the same-name variants it stands for. */
export interface ReadinessColumn {
  quest: DungeonQuestDto;
  variants: DungeonQuestDto[];
}

/** Faction variants share name + dungeon + class limit; race may differ. */
function variantKey(q: DungeonQuestDto): string {
  const classes = [...(q.classRestriction ?? [])].sort().join(',');
  return `${q.name}::${q.dungeonInstanceId}::${classes}`;
}

/** The side-specific variant (most precise) first, else the first seen. */
function representative(variants: DungeonQuestDto[]): DungeonQuestDto | null {
  const specific = variants.find((q) => (q.raceRestriction?.length ?? 0) > 0);
  return specific ?? variants[0] ?? null;
}

/** The roster's columns, in event-quest order (first variant's position). */
export function readinessColumns(
  quests: DungeonQuestDto[],
  side: FactionSide | null,
): ReadinessColumn[] {
  if (side === null) return quests.map((q) => ({ quest: q, variants: [q] }));
  const groups = new Map<string, DungeonQuestDto[]>();
  for (const q of quests) {
    if (!isQuestUsableBySide(q, side)) continue;
    const key = variantKey(q);
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  return [...groups.values()].flatMap((variants) => {
    const quest = representative(variants);
    return quest ? [{ quest, variants }] : [];
  });
}
