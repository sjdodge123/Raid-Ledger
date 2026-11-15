/**
 * ROK-2207 prototype — the planner's state over the fixtures, restored from
 * the URL on load (`?c=…&d=…`, OQ5) and the links it builds.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { WowInstanceDto } from '@raid-ledger/contract';
import { DALARAN_ID, DEMO_GAME_ID, DEMO_GUILD_ID, ROSTER } from './dungeon-planner.fixtures';
import { INSTANCES, instanceById } from './forever-dungeons.fixtures';
import { createEventUrl, invitable, parsePlanQuery, shareUrl, type PlannerCharacter } from './planner-helpers';

export const MAX_CHARS = 5;
export const MAX_DUNGEONS = 3;

/** One plan: up to five roster characters and one (or, for OQ2 B, up to three) dungeons. */
export interface PlannerState {
    instance: WowInstanceDto;
    dungeons: WowInstanceDto[];
    chars: PlannerCharacter[];
    /** Roster rows not yet picked (the "+ Add character" picker's options). */
    available: PlannerCharacter[];
    canAdd: boolean;
    setInstanceId: (id: number) => void;
    toggleDungeon: (id: number) => void;
    add: (name: string) => void;
    remove: (name: string) => void;
}

const FALLBACK: WowInstanceDto = { id: 0, name: '—', expansion: 'Forever' };

/** Initial names + dungeon ids: the URL wins over the frame's defaults. */
function useInitialPlan(names: string[], dungeonIds: number[], readUrl: boolean): { names: string[]; dungeonIds: number[] } {
    const [params] = useSearchParams();
    const fromUrl = readUrl ? parsePlanQuery(params.toString()) : {};
    const known = (fromUrl.names ?? names).filter((n) => ROSTER.some((r) => r.name === n)).slice(0, MAX_CHARS);
    const ids = (fromUrl.dungeonIds ?? dungeonIds).filter((id) => instanceById(id)).slice(0, MAX_DUNGEONS);
    return { names: known, dungeonIds: ids.length ? ids : [DALARAN_ID] };
}

/**
 * Planner state for one frame; `names`/`dungeonIds` are the defaults when the URL carries none.
 * `readUrl: false` pins a frame to its defaults (the empty-group frame).
 */
export function usePlannerState(names: string[], dungeonIds: number[] = [DALARAN_ID], readUrl: boolean = true): PlannerState {
    const initial = useInitialPlan(names, dungeonIds, readUrl);
    const [picked, setPicked] = useState<string[]>(initial.names);
    const [ids, setIds] = useState<number[]>(initial.dungeonIds);
    const dungeons = ids.flatMap((id) => instanceById(id) ?? []);
    const chars = picked.flatMap((n) => ROSTER.find((r) => r.name === n) ?? []);
    return {
        instance: dungeons[0] ?? INSTANCES[0] ?? FALLBACK, dungeons, chars,
        available: ROSTER.filter((r) => !picked.includes(r.name)),
        canAdd: picked.length < MAX_CHARS,
        setInstanceId: (id) => setIds([id]),
        toggleDungeon: (id) => setIds((cur) => toggled(cur, id)),
        add: (name) => setPicked((n) => (n.length < MAX_CHARS && !n.includes(name) ? [...n, name] : n)),
        remove: (name) => setPicked((n) => n.filter((x) => x !== name)),
    };
}

function toggled(cur: number[], id: number): number[] {
    if (cur.includes(id)) return cur.length > 1 ? cur.filter((x) => x !== id) : cur;
    return cur.length < MAX_DUNGEONS ? [...cur, id] : cur;
}

/** Share link (this page + `?c=…&d=…`) and the two Create-event URLs for one dungeon. */
export function plannerLinks(s: PlannerState, instanceId: number = s.instance.id): {
    share: string; plain: string; invite: string; inviteCount: number; excluded: string[];
} {
    const { ids, excluded } = invitable(s.chars);
    const base = { gameId: DEMO_GAME_ID, guildId: DEMO_GUILD_ID, instanceIds: [instanceId] };
    const page = `${window.location.origin}${window.location.pathname}`;
    return {
        share: shareUrl(page, { names: s.chars.map((c) => c.name), dungeonIds: s.dungeons.map((d) => d.id) }),
        plain: createEventUrl(base),
        invite: createEventUrl({ ...base, inviteCharacterIds: ids }),
        inviteCount: ids.length, excluded,
    };
}
