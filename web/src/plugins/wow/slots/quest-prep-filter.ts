/**
 * Quest Prep panel filtering: which of the event's quests the viewer can take.
 *
 * ROK-2211: the side comes from the viewer's character (race, else its
 * faction column); a viewer with no character or an unknown side falls back
 * to the event's guild faction (a guild is always single-faction). With no
 * side at all, both factions' quests show and the panel says so.
 */
import { useMemo } from 'react';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';
import type { useCharacterDetail } from '../../../hooks/use-character-detail';
import { useGuildPage } from '../../../components/hub/api/use-guild';
import { factionKey } from '../hub/wow-hero.helpers';
import { isQuestUsable, deduplicateByName } from '../utils/quest-dedup';
import { deriveCharacterSide, type QuestSide } from '../utils/quest-faction';

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

/** The viewer's side: their character's, else the event guild's faction; null when neither is known. */
export function useQuestSide(character: PanelCharacter, guildId: number | null | undefined): QuestSide | null {
    const { data: guildPage } = useGuildPage(guildId ?? 0);
    const own = deriveCharacterSide(character?.race, character?.faction);
    return own ?? factionKey(guildPage?.guild.faction ?? null);
}
