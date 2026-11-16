/**
 * ROK-2215 (L7) — names for a plan's `inviteCharacterIds`, read from the hub's
 * already-cached roster insights (no new endpoint). Ids the roster does not
 * hold are counted as `unresolved`; no hub → every id is unresolved.
 */
import { useMemo } from 'react';
import { useRosterInsights } from '../hub-widgets/use-roster-insights';

export interface CharacterNames {
    names: string[];
    unresolved: number;
}

/** Resolved names in request order, plus how many ids had no name. */
export function useCharacterNames(guildId: number | null, ids: string[]): CharacterNames {
    const { data } = useRosterInsights(ids.length > 0 ? guildId ?? 0 : 0);
    return useMemo(() => {
        const byId = new Map<string, string>();
        for (const cls of data?.classes ?? []) {
            for (const m of cls.members) if (m.characterId) byId.set(m.characterId, m.name);
        }
        const names = ids.flatMap((id) => {
            const name = byId.get(id);
            return name === undefined ? [] : [name];
        });
        return { names, unresolved: ids.length - names.length };
    }, [data, ids]);
}
