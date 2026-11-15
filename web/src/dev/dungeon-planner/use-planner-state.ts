/**
 * ROK-2207 prototype — the planner's state over the fixtures, restored from
 * the URL on load (`?c=…&d=…`, OQ5) and the links it builds. One dungeon per
 * plan (OQ2 ruled ~19:00Z).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { WowInstanceDto } from '@raid-ledger/contract';
import { DALARAN_ID, DEMO_GAME_ID, DEMO_GUILD_ID, ROSTER } from './dungeon-planner.fixtures';
import { INSTANCES, instanceById } from './forever-dungeons.fixtures';
import { createEventUrl, invitable, parsePlanQuery, shareUrl, type PlanQuery, type PlannerCharacter } from './planner-helpers';

export const MAX_CHARS = 5;

/** One plan: up to five roster characters and one dungeon. */
export interface PlannerState {
    instance: WowInstanceDto;
    chars: PlannerCharacter[];
    /** Roster rows not yet picked (the "+ Add character" picker's options). */
    available: PlannerCharacter[];
    canAdd: boolean;
    setInstanceId: (id: number) => void;
    add: (name: string) => void;
    remove: (name: string) => void;
}

const FALLBACK: WowInstanceDto = { id: 0, name: '—', expansion: 'Forever' };

/** Initial names + dungeon id: the URL wins over the frame's defaults. */
function useInitialPlan(names: string[], dungeonId: number, readUrl: boolean): { names: string[]; dungeonId: number } {
    const [params] = useSearchParams();
    const fromUrl: PlanQuery = readUrl ? parsePlanQuery(params.toString()) : {};
    const known = (fromUrl.names ?? names).filter((n) => ROSTER.some((r) => r.name === n)).slice(0, MAX_CHARS);
    const urlId = fromUrl.dungeonId;
    return { names: known, dungeonId: urlId !== undefined && instanceById(urlId) ? urlId : dungeonId };
}

/**
 * Planner state for one frame; `names`/`dungeonId` are the defaults when the URL carries none.
 * `readUrl: false` pins a frame to its defaults (the empty-group frame).
 */
export function usePlannerState(names: string[], dungeonId: number = DALARAN_ID, readUrl: boolean = true): PlannerState {
    const initial = useInitialPlan(names, dungeonId, readUrl);
    const [picked, setPicked] = useState<string[]>(initial.names);
    const [id, setId] = useState<number>(initial.dungeonId);
    // Stable across renders so consumers' memos (e.g. quest readiness) only recompute on a pick change.
    const chars = useMemo(() => picked.flatMap((n) => ROSTER.find((r) => r.name === n) ?? []), [picked]);
    return {
        instance: instanceById(id) ?? INSTANCES[0] ?? FALLBACK,
        chars,
        available: ROSTER.filter((r) => !picked.includes(r.name)),
        canAdd: picked.length < MAX_CHARS,
        setInstanceId: setId,
        add: (name) => setPicked((n) => (n.length < MAX_CHARS && !n.includes(name) ? [...n, name] : n)),
        remove: (name) => setPicked((n) => n.filter((x) => x !== name)),
    };
}

/** The links one plan builds. */
export interface PlannerLinks {
    share: string; plain: string; invite: string; inviteCount: number; excluded: string[];
}

/** Share link (this page + `?c=…&d=…`) and the two Create-event URLs for the plan's dungeon. */
export function plannerLinks(s: PlannerState): PlannerLinks {
    const { ids, excluded } = invitable(s.chars);
    const base = { gameId: DEMO_GAME_ID, guildId: DEMO_GUILD_ID, instanceIds: [s.instance.id] };
    const page = `${window.location.origin}${window.location.pathname}`;
    return {
        share: shareUrl(page, s.chars.map((c) => c.name), s.instance.id),
        plain: createEventUrl(base),
        invite: createEventUrl({ ...base, inviteCharacterIds: ids }),
        inviteCount: ids.length, excluded,
    };
}
