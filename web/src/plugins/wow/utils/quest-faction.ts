/**
 * ROK-2211: which faction's dungeon quests a character (or guild) can take.
 *
 * Quests carry no faction field — the side is implied by `raceRestriction`
 * (null or [] = neutral, always kept). A guild is always single-faction, so a
 * viewer whose side is unknown falls back to the side of the event's signups,
 * then to the guild's faction.
 *
 * Mirrors the api's `characterSide` / `isQuestUsableBySide` / `sharedSide` and
 * their race sets in `api/src/plugins/wow-common/quest-faction.helpers.ts`
 * (ROK-1758 web/api lockstep).
 */
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';
import { factionKey, type FactionKey } from '../hub/wow-hero.helpers';

export type QuestSide = FactionKey;

const HORDE_RACES = new Set(['orc', 'undead', 'scourge', 'tauren', 'troll', 'blood elf', 'bloodelf']);
const ALLIANCE_RACES = new Set(['human', 'dwarf', 'night elf', 'nightelf', 'gnome', 'draenei']);

/** A race (display name or addon token) → its faction; unknown → null. */
export function factionOfRace(race: string | null | undefined): QuestSide | null {
    const key = race?.trim().toLowerCase() ?? '';
    if (HORDE_RACES.has(key)) return 'horde';
    if (ALLIANCE_RACES.has(key)) return 'alliance';
    return null;
}

/** The character's side: its race's faction, else its stored `faction` column; unknown → null. */
export function characterSide(
    race: string | null | undefined,
    faction: string | null | undefined,
): QuestSide | null {
    return factionOfRace(race) ?? factionKey(faction ?? null);
}

/**
 * True when a quest is takeable by `side`. Neutral quests (no race list) are
 * always kept; an unknown side keeps everything; a race list naming no known
 * race is kept rather than guessed at (unknown data is never hidden).
 */
export function isQuestUsableBySide(quest: Pick<EnrichedDungeonQuestDto, 'raceRestriction'>, side: QuestSide | null): boolean {
    const races = quest.raceRestriction;
    if (!races || races.length === 0 || !side) return true;
    const sides = new Set(races.map(factionOfRace).filter((s): s is QuestSide => s !== null));
    return sides.size === 0 || sides.has(side);
}

/** The side a roster shares: unknowns ignored; disagreeing or all-unknown sides → null. */
export function sharedSide(sides: Iterable<QuestSide | null>): QuestSide | null {
    let shared: QuestSide | null = null;
    for (const side of sides) {
        if (side === null) continue;
        if (shared !== null && shared !== side) return null;
        shared = side;
    }
    return shared;
}

/** True when any quest is limited to one faction (its race list names a known race). */
export function hasFactionQuest(quests: readonly Pick<EnrichedDungeonQuestDto, 'raceRestriction'>[]): boolean {
    return quests.some((q) => (q.raceRestriction ?? []).some((r) => factionOfRace(r) !== null));
}
