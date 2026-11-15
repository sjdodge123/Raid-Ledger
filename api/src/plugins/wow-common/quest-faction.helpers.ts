/**
 * ROK-2211: a character's faction side and whether a quest suits it. Quests
 * carry no faction field; their side is implied by `raceRestriction` (null or
 * `[]` = neutral). A guild is always single-faction (operator, 2026-11-15).
 * Pure, no imports: shared by the attunement evaluator, the quest usable
 * filter and the hub readiness matrix. Mirrored by the web quest filter.
 */

/** A WoW faction side. */
export type FactionSide = 'horde' | 'alliance';

const HORDE_RACES = new Set([
  'orc',
  'undead',
  'scourge',
  'tauren',
  'troll',
  'blood elf',
  'bloodelf',
]);
const ALLIANCE_RACES = new Set([
  'human',
  'dwarf',
  'night elf',
  'nightelf',
  'gnome',
  'draenei',
]);

/** A race (display name or addon token) → its faction; unknown → null. */
export function factionOfRace(
  race: string | null | undefined,
): FactionSide | null {
  const key = race?.trim().toLowerCase() ?? '';
  if (HORDE_RACES.has(key)) return 'horde';
  if (ALLIANCE_RACES.has(key)) return 'alliance';
  return null;
}

/** A stored faction column ("Horde", "alliance") → its side; else null. */
export function factionOfColumn(
  faction: string | null | undefined,
): FactionSide | null {
  const key = faction?.trim().toLowerCase();
  return key === 'horde' || key === 'alliance' ? key : null;
}

/** A character's side: its race first, else its stored faction column. */
export function characterSide(
  race: string | null | undefined,
  faction: string | null | undefined,
): FactionSide | null {
  return factionOfRace(race) ?? factionOfColumn(faction);
}

/**
 * Whether a character of `side` can take the quest: neutral (null / empty
 * `raceRestriction`) → true; unknown side → true (no filter, as before
 * ROK-2211); a race list naming no known race → true (unknown data is never
 * hidden); else true iff a listed race belongs to that side. Mirrors web
 * `utils/quest-faction.ts::isQuestUsableBySide`.
 */
export function isQuestUsableBySide(
  quest: { raceRestriction: string[] | null },
  side: FactionSide | null,
): boolean {
  const races = quest.raceRestriction;
  if (!races || races.length === 0 || side === null) return true;
  const sides = races.map(factionOfRace).filter((s) => s !== null);
  return sides.length === 0 || sides.includes(side);
}

/**
 * The side a roster shares: every known side agrees → that side. Unknown
 * entries are ignored; disagreeing or all-unknown sides → null (no filter).
 */
export function sharedSide(
  sides: Iterable<FactionSide | null>,
): FactionSide | null {
  let shared: FactionSide | null = null;
  for (const side of sides) {
    if (side === null) continue;
    if (shared !== null && shared !== side) return null;
    shared = side;
  }
  return shared;
}
