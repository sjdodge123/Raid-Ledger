/**
 * ROK-2216 — the Dungeon planner's state. The URL IS the plan (ROK-2207 OQ5,
 * spec L1): `?d=<instanceId>&c=<token>,…` on the hub page, written with
 * `replace` so picking never floods history, and the `#dungeon-planner` hash
 * is kept. Picks resolve against the hub roster (spec L2); once the roster
 * lands, tokens not on it are dropped and the link is rewritten once.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MAX_DUNGEON_PLAN_CHARACTERS, type WowRosterInsightsDto } from '@raid-ledger/contract';
import { parsePlanQuery, planSearch, toCharacterIds, type PlanState, type PlanToken } from './planner-url';
import { resolvePicks, rosterPicks, type RosterPick } from './planner-roster';

/** The plan as the planner tab renders and edits it. */
export interface PlannerState {
    instanceId: number | null;
    /** Picks in link order (roster rows); [] until the roster loads. */
    picks: RosterPick[];
    /** Roster rows not yet picked — the picker's options. */
    available: RosterPick[];
    /** False once five characters are picked. */
    canAdd: boolean;
    /** The link's own tokens (URL state) — what Copy link shares, even before the roster loads. */
    linkTokens: PlanToken[];
    /** Claimed picks' character ids — the only ids the plan API and invites take. */
    characterIds: string[];
    setInstanceId: (id: number | null) => void;
    /** Add a roster row by its `RosterPick.key`; a no-op past five, for a duplicate or an unknown key. */
    add: (key: string) => void;
    remove: (key: string) => void;
}

/** The plan in the URL and a writer that keeps the hash and replaces history. */
function usePlanUrl(): { plan: PlanState; write: (next: PlanState) => void } {
    const { search, hash } = useLocation();
    const navigate = useNavigate();
    const plan = useMemo(() => parsePlanQuery(search), [search]);
    const write = useCallback((next: PlanState): void => {
        const s = planSearch(next);
        void navigate({ search: s ? `?${s}` : '', hash }, { replace: true });
    }, [navigate, hash]);
    return { plan, write };
}

/** Once the roster is known, drop link tokens that are not on it (one rewrite per mount). */
function useDropStaleTokens(plan: PlanState, picks: RosterPick[] | null, write: (next: PlanState) => void): void {
    const done = useRef(false);
    useEffect(() => {
        if (done.current || picks === null) return;
        done.current = true;
        if (picks.length !== plan.tokens.length) write({ ...plan, tokens: picks.map((p) => p.token) });
    }, [plan, picks, write]);
}

/** Planner state over the hub roster (`undefined` while roster-insights loads). */
export function usePlannerState(roster: Pick<WowRosterInsightsDto, 'classes'> | undefined): PlannerState {
    const { plan, write } = usePlanUrl();
    const options = useMemo(() => rosterPicks(roster), [roster]);
    const resolved = useMemo(() => (roster ? resolvePicks(plan.tokens, options) : null), [roster, plan.tokens, options]);
    useDropStaleTokens(plan, resolved, write);
    const picks = resolved ?? [];
    const tokens: PlanToken[] = resolved ? resolved.map((p) => p.token) : plan.tokens;
    const canAdd = tokens.length < MAX_DUNGEON_PLAN_CHARACTERS;
    const add = (key: string): void => {
        const option = options.find((o) => o.key === key);
        if (!option || !canAdd || picks.some((p) => p.key === key)) return;
        write({ ...plan, tokens: [...tokens, option.token] });
    };
    return {
        instanceId: plan.instanceId, picks, canAdd, linkTokens: plan.tokens,
        available: options.filter((o) => !picks.some((p) => p.key === o.key)),
        characterIds: toCharacterIds(tokens),
        setInstanceId: (id) => write({ ...plan, instanceId: id, tokens }),
        add,
        remove: (key) => write({ ...plan, tokens: picks.filter((p) => p.key !== key).map((p) => p.token) }),
    };
}
