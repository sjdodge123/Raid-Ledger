/**
 * Quest deduplication utilities.
 *
 * Quests that share the same name within a dungeon (e.g. faction- or class-specific
 * variants) are merged so only the best match for the character is shown.
 */
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';

/** Check if a quest is usable by a character's class/race */
export function isQuestUsable(
    quest: EnrichedDungeonQuestDto,
    charClass: string | null,
    charRace: string | null,
): boolean {
    const classRestrictions = quest.classRestriction as string[] | null;
    const raceRestrictions = quest.raceRestriction as string[] | null;

    const classMatch = !classRestrictions || classRestrictions.length === 0
        || !charClass
        || classRestrictions.some(c => c.toLowerCase() === charClass.toLowerCase());
    const raceMatch = !raceRestrictions || raceRestrictions.length === 0
        || !charRace
        || raceRestrictions.some(r => r.toLowerCase() === charRace.toLowerCase());
    return classMatch && raceMatch;
}

/**
 * Pick the best variant from a group of quests that share the same name.
 * Priority: exact race+class match > unrestricted > first encountered.
 */
export function pickBestVariant(
    variants: EnrichedDungeonQuestDto[],
    charClass: string | null,
    charRace: string | null,
): EnrichedDungeonQuestDto {
    if (charRace || charClass) {
        const exact = variants.find((q) => {
            const rr = q.raceRestriction as string[] | null;
            const cr = q.classRestriction as string[] | null;
            const raceOk = rr?.length
                ? charRace && rr.some(r => r.toLowerCase() === charRace.toLowerCase())
                : true;
            const classOk = cr?.length
                ? charClass && cr.some(c => c.toLowerCase() === charClass.toLowerCase())
                : true;
            return raceOk && classOk;
        });
        if (exact) return exact;
    }
    const best = variants.find((q) => {
        const rr = q.raceRestriction as string[] | null;
        const cr = q.classRestriction as string[] | null;
        return (!rr || rr.length === 0) && (!cr || cr.length === 0);
    }) ?? variants[0];
    if (!best) throw new Error('pickBestVariant needs at least one variant');
    return best;
}

/**
 * Deduplicate quests that share the same name within the same dungeon.
 * Faction/class variants are merged to show only the best-matching quest.
 */
export function deduplicateByName(
    quests: EnrichedDungeonQuestDto[],
    charClass: string | null,
    charRace: string | null,
): EnrichedDungeonQuestDto[] {
    const groups = new Map<string, EnrichedDungeonQuestDto[]>();
    for (const q of quests) {
        const key = `${q.name}::${q.dungeonInstanceId}`;
        const list = groups.get(key);
        if (list) list.push(q);
        else groups.set(key, [q]);
    }
    // Every group holds at least one quest, and a lone variant is its own best pick.
    return [...groups.values()].map((variants) => pickBestVariant(variants, charClass, charRace));
}
