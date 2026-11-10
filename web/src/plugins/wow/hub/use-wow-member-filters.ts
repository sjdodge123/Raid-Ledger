/**
 * ROK-1173 — the WoW module's `useMemberFilters` hook: filter state in
 * component state (spec Q7: the hub owns the hash; ROK-2172's one exception is
 * `#members?role=<role>`, see `wow-role-filter.helpers.ts`), the options
 * derived from the listed rows, and professions joined from roster insights by
 * `characterId` (spec D2). `matches` is memoised — core lists it as a
 * `useMemo` dependency.
 */
import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import type { CharacterRole } from '@raid-ledger/contract';
import type { HubCtx, HubMemberFilters, HubMemberRow } from '../../hub-module';
import { useRosterInsights } from '../hub-widgets/use-roster-insights';
import { WowMemberFilterControls } from './wow-member-filters';
import { WowProfessionCoverage } from './wow-profession-coverage';
import { RoleSummary } from './role-bits';
import { filterStateFromHash, syncMembersHash } from './wow-role-filter.helpers';
import {
    EMPTY_WOW_MEMBER_FILTERS, buildProfessionIndex, countActiveWowFilters, professionCoverage,
    toggleValue, wowFilterOptions, wowMemberMatches, type WowMemberFilterState,
} from './wow-member-filters.helpers';

/** ROK-2172: seeded from `#members?role=…` on mount (a fresh Members mount, e.g. "See members", starts empty), mirrored back to the hash. */
function useHashSeededFilterState() {
    const [state, setState] = useState<WowMemberFilterState>(() => filterStateFromHash(window.location.hash));
    useEffect(() => { syncMembersHash(state); }, [state]);
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
    const coverage = useMemo(() => (raw === undefined ? undefined : professionCoverage(raw)), [raw]);
    const options = useMemo(() => wowFilterOptions(rows), [rows]);
    const matches = useCallback((row: HubMemberRow) => wowMemberMatches(state, row, index), [state, index]);
    const clearAll = useCallback(() => setState(EMPTY_WOW_MEMBER_FILTERS), []);
    const toggleProfession = useCallback(
        (name: string) => setState((s) => ({ ...s, professions: toggleValue(s.professions, name) })),
        [],
    );
    return {
        activeCount: countActiveWowFilters(state),
        matches,
        clearAll,
        controls: createElement(WowMemberFilterControls, { state, options, professions: coverage, onChange: setState }),
        summary: createElement(RoleSummary, { counts: ctx.page.roleCounts, selected: state.roles, onToggle: toggleRole }),
        lead: createElement(WowProfessionCoverage, { rows, professions: coverage, index, selected: state.professions, onToggle: toggleProfession }),
    };
}
