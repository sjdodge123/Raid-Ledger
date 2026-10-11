/**
 * ROK-1758: server mirror of `web/src/plugins/wow/utils/quest-dedup.ts`
 * (`deduplicateByName` + `pickBestVariant`), so the viewer's pre-req count
 * covers exactly the quests the event panel shows — including a character
 * with no race, where both faction variants pass the usable filter.
 */
import type { DungeonQuestDto } from './dungeon-quests.types';

type Variant = Pick<
  DungeonQuestDto,
  'name' | 'dungeonInstanceId' | 'classRestriction' | 'raceRestriction'
>;

/** A restricted list needs the value present and listed; an empty list passes. */
function matches(list: string[] | null, value: string | null): boolean {
  if (!list || list.length === 0) return true;
  if (!value) return false;
  const wanted = value.toLowerCase();
  return list.some((entry) => entry.toLowerCase() === wanted);
}

const isUnrestricted = (q: Variant): boolean =>
  !q.raceRestriction?.length && !q.classRestriction?.length;

/** Exact race+class match > unrestricted > first encountered (web order). */
function pickBestVariant<T extends Variant>(
  variants: T[],
  charClass: string | null,
  charRace: string | null,
): T {
  const exact =
    charRace || charClass
      ? variants.find(
          (q) =>
            matches(q.raceRestriction, charRace) &&
            matches(q.classRestriction, charClass),
        )
      : undefined;
  const best = exact ?? variants.find(isUnrestricted) ?? variants[0];
  if (!best) throw new Error('pickBestVariant needs at least one variant');
  return best;
}

/** One quest per name within a dungeon, the best match for the character. */
export function dedupeVariantsByName<T extends Variant>(
  quests: T[],
  charClass: string | null,
  charRace: string | null,
): T[] {
  const groups = new Map<string, T[]>();
  for (const q of quests) {
    const key = `${q.name}::${q.dungeonInstanceId}`;
    const list = groups.get(key);
    if (list) list.push(q);
    else groups.set(key, [q]);
  }
  return [...groups.values()].map((v) =>
    pickBestVariant(v, charClass, charRace),
  );
}
