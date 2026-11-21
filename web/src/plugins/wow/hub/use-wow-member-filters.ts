/**
 * ROK-1173 — the WoW module's `useMemberFilters` hook: filter state in
 * component state (spec Q7: the hub owns the hash; ROK-2172's one exception is
 * `#members?role=<role>`, see `wow-role-filter.helpers.ts`), the options
 * derived from the listed rows, and professions joined from roster insights by
 * `characterId` (spec D2). `matches` and `extraSorts` (ROK-2281: the
 * per-profession sorts) are memoised — core lists them as `useMemo` dependencies.
 */
import { createElement, useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { CharacterRole } from '@raid-ledger/contract';
import type { HubCtx, HubMemberFilters, HubMemberRow } from '../../hub-module';
import { useRosterInsights } from '../hub-widgets/use-roster-insights';
import { WowMemberFilterControls } from './wow-member-filters';
import { WowProfessionCoverage } from './wow-profession-coverage';
import { RoleSummary } from './role-bits';
import { filterStateFromHash, followMembersHash, syncMembersHash } from './wow-role-filter.helpers';
import {
    EMPTY_WOW_MEMBER_FILTERS, buildProfessionIndex, countActiveWowFilters, professionCoverage,
    toggleValue, wowFilterOptions, wowMemberMatches, type WowMemberFilterState,
} from './wow-member-filters.helpers';
import { buildProfessionSkillIndex, professionSorts } from './wow-profession-sorts';

/** ROK-2172: re-seed on `hashchange` / `popstate` (the Members tab, Back/Forward, a hand-edited `?role=`); `replaceState` fires neither, so no loop. */
function useFollowMembersHash(setState: Dispatch<SetStateAction<WowMemberFilterState>>): void {
    useEffect(() => {
        const follow = () => setState((s) => followMembersHash(s, window.location.hash));
        window.addEventListener('hashchange', follow);
        window.addEventListener('popstate', follow);
        return () => {
            window.removeEventListener('hashchange', follow);
            window.removeEventListener('popstate', follow);
        };
    }, [setState]);
}

/** ROK-2172: seeded from `#members?role=…` on mount (a fresh Members mount, e.g. "See members", starts empty), kept in step with the hash both ways. */
function useHashSeededFilterState() {
    const [state, setState] = useState<WowMemberFilterState>(() => filterStateFromHash(window.location.hash));
    useEffect(() => { syncMembersHash(state); }, [state]);
    useFollowMembersHash(setState);
    const toggleRole = useCallback(
        (role: CharacterRole) => setState((s) => ({ ...s, roles: toggleValue(s.roles, role) })),
        [],
    );
    return { state, setState, toggleRole };
}

export function useWowMemberFilters(ctx: HubCtx, rows: readonly HubMemberRow[]): HubMemberFilters {
    const { state, setState, toggleRole } = useHashSeededFilterState();
    const insights = useRosterInsights(ctx.page.guild.id);
    const raw = insights.data?.professions;
    const index = useMemo(() => buildProfessionIndex(raw), [raw]);
    const skills = useMemo(() => buildProfessionSkillIndex(raw), [raw]);
    // ROK-2281: a high→low / low→high pair per picked profession pill.
    const extraSorts = useMemo(() => professionSorts(state.professions, skills), [state.professions, skills]);
    const coverage = useMemo(() => (raw === undefined ? undefined : professionCoverage(raw)), [raw]);
    const options = useMemo(() => wowFilterOptions(rows), [rows]);
    const matches = useCallback((row: HubMemberRow) => wowMemberMatches(state, row, index), [state, index]);
    const clearAll = useCallback(() => setState(EMPTY_WOW_MEMBER_FILTERS), [setState]);
    const toggleProfession = useCallback(
        (name: string) => setState((s) => ({ ...s, professions: toggleValue(s.professions, name) })),
        [setState],
    );
    return {
        activeCount: countActiveWowFilters(state),
        matches,
        clearAll,
        controls: createElement(WowMemberFilterControls, { state, options, professions: coverage, onChange: setState }),
        // No rows (a visitor on a members-first hub): read-only pills, nothing to toggle over.
        summary: createElement(RoleSummary, rows.length > 0
            ? { counts: ctx.page.roleCounts, selected: state.roles, onToggle: toggleRole }
            : { counts: ctx.page.roleCounts }),
        extraSorts,
        lead: createElement(WowProfessionCoverage, { rows, professions: coverage, index, selected: state.professions, onToggle: toggleProfession }),
    };
}
