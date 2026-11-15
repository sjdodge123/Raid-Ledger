/**
 * Quest Prep panel filtering: which of the event's quests the viewer can take.
 *
 * ROK-2211: the side comes from the viewer's character (race, else its
 * faction column). A guild is always single-faction, so an unknown side falls
 * back to the side the event's signed-up characters share, and only then to
 * the guild page (membership-gated, so asked for only when still unknown).
 * With no side at all, both factions' quests show and the panel says so.
 */
import { useMemo } from 'react';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';
import type { useCharacterDetail } from '../../../hooks/use-character-detail';
import { useGuildPage } from '../../../components/hub/api/use-guild';
import { factionKey } from '../hub/wow-hero.helpers';
import { isQuestUsable, deduplicateByName } from '../utils/quest-dedup';
import { characterSide, sharedSide, type QuestSide } from '../utils/quest-faction';

export type PanelCharacter = ReturnType<typeof useCharacterDetail>['data'];

/** Flatten a questsByInstance map into a single array */
export function flattenQuestMap(questMap: Map<number, EnrichedDungeonQuestDto[]> | undefined): EnrichedDungeonQuestDto[] {
    if (!questMap) return [];
    const seen = new Set<number>();
    const result: EnrichedDungeonQuestDto[] = [];
    for (const batch of questMap.values()) {
        for (const q of batch) {
            if (!seen.has(q.questId)) { seen.add(q.questId); result.push(q); }
        }
    }
    return result;
}

/** Filter and deduplicate quests for a character, judging a raceless one by `side`. */
export function filterUsableQuests(quests: EnrichedDungeonQuestDto[], character: PanelCharacter, side: QuestSide | null) {
    if (quests.length === 0) return [];
    const charClass = character?.class ?? null;
    const charRace = character?.race ?? null;
    return deduplicateByName(quests.filter((q) => isQuestUsable(q, charClass, charRace, side)), charClass, charRace);
}

export function useAllUsableQuests(
    questMap: Map<number, EnrichedDungeonQuestDto[]> | undefined, character: PanelCharacter, side: QuestSide | null,
) {
    return useMemo(() => filterUsableQuests(flattenQuestMap(questMap), character, side), [questMap, character, side]);
}

/** A signed-up character's race / faction, as the event roster carries them. */
export type RosterCharacter = { race?: string | null; faction?: string | null } | null | undefined;

/** The side the event's signed-up characters share (null when unknown or mixed). */
export function rosterSide(characters: readonly RosterCharacter[] | undefined): QuestSide | null {
    return sharedSide((characters ?? []).map((c) => characterSide(c?.race, c?.faction)));
}

/**
 * The viewer's side: their character's, else the signups' shared side, else the
 * guild's faction. `lookupGuild` false (no dungeon, character still loading)
 * keeps GET /guilds/:id from firing; it also never fires once a side is known.
 */
export function useQuestSide(
    character: PanelCharacter, roster: readonly RosterCharacter[] | undefined,
    guildId: number | null | undefined, lookupGuild: boolean,
): QuestSide | null {
    const known = characterSide(character?.race, character?.faction) ?? rosterSide(roster);
    const { data: guildPage } = useGuildPage(known === null && lookupGuild ? guildId ?? 0 : 0);
    return known ?? factionKey(guildPage?.guild.faction ?? null);
}
