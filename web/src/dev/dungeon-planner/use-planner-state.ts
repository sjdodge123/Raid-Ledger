/**
 * ROK-2207 prototype — the planner's local state over the fixtures and the
 * links it builds. The build keeps this state in the URL (spec D5).
 */
import { useState } from 'react';
import type { WowInstanceDto } from '@raid-ledger/contract';
import { CHARACTERS, DALARAN_ID, DEMO_GAME_ID, DEMO_GUILD_ID, DEMO_HUB_ID, INSTANCES } from './dungeon-planner.fixtures';
import { createEventUrl, shareUrl, type PlannerCharacter } from './planner-helpers';

/** The planner's local state: one dungeon + up to five characters (starts with three). */
export interface PlannerState {
    instance: WowInstanceDto;
    chars: PlannerCharacter[];
    setInstanceId: (id: number) => void;
    remove: (name: string) => void;
    addNext: () => void;
    canAdd: boolean;
}

/** Local planner state over the fixtures. */
export function usePlannerState(initialCount: number = 3): PlannerState {
    const [instanceId, setInstanceId] = useState(DALARAN_ID);
    const [names, setNames] = useState<string[]>(CHARACTERS.slice(0, initialCount).map((c) => c.name));
    const instance = INSTANCES.find((i) => i.id === instanceId) ?? INSTANCES[0] ?? { id: 0, name: '—', expansion: '' };
    const chars = CHARACTERS.filter((c) => names.includes(c.name));
    const nextFree = CHARACTERS.find((c) => !names.includes(c.name));
    return {
        instance, chars, setInstanceId,
        remove: (name) => setNames((n) => n.filter((x) => x !== name)),
        addNext: () => { if (nextFree) setNames((n) => [...n, nextFree.name]); },
        canAdd: nextFree !== undefined,
    };
}

/** Share link + the two Create-event URLs for the current plan. */
export function plannerLinks(s: PlannerState): { share: string; plain: string; invite: string } {
    const ids = s.chars.flatMap((c) => (c.characterId ? [c.characterId] : []));
    const base = { gameId: DEMO_GAME_ID, guildId: DEMO_GUILD_ID, instanceIds: [s.instance.id] };
    return {
        share: shareUrl(window.location.origin, { hubId: DEMO_HUB_ID, instanceId: s.instance.id, characterIds: ids }),
        plain: createEventUrl(base),
        invite: createEventUrl({ ...base, inviteCharacterIds: ids }),
    };
}

