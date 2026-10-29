/**
 * ROK-1173 — the WoW module's `useMemberFilters` hook: filter state in
 * component state (spec Q7: no URL params, the hub owns the hash), the options
 * derived from the listed rows, and professions joined from roster insights by
 * `characterId` (spec D2). `matches` is memoised — core lists it as a
 * `useMemo` dependency.
 */
import { createElement, useCallback, useMemo, useState } from 'react';
import type { HubCtx, HubMemberFilters, HubMemberRow } from '../../hub-module';
import { useRosterInsights } from '../hub-widgets/use-roster-insights';
import { WowMemberFilterControls } from './wow-member-filters';
import { WowProfessionCoverage } from './wow-profession-coverage';
import {
    EMPTY_WOW_MEMBER_FILTERS, buildProfessionIndex, countActiveWowFilters, professionCoverage,
    toggleValue, wowFilterOptions, wowMemberMatches, type WowMemberFilterState,
} from './wow-member-filters.helpers';

export function useWowMemberFilters(ctx: HubCtx, rows: readonly HubMemberRow[]): HubMemberFilters {
    const [state, setState] = useState<WowMemberFilterState>(EMPTY_WOW_MEMBER_FILTERS);
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
        lead: createElement(WowProfessionCoverage, { rows, professions: coverage, selected: state.professions, onToggle: toggleProfession }),
    };
}
