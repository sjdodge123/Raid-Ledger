/** ROK-2216 — `usePlannerState`: the URL is the plan (spec L1, ROK-2207 OQ5). */
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { usePlannerState } from './use-planner-state';
import { ROSTER, UUID_A, UUID_B } from './planner-roster.fixtures';

const STALE = '00000000-0000-4000-8000-000000000099';

/** `roster: null` = roster-insights still loading (a default param would swallow `undefined`). */
function render(entry: string, roster: typeof ROSTER | null = ROSTER) {
    const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
    return renderHook(() => ({ state: usePlannerState(roster ?? undefined), loc: useLocation() }), { wrapper });
}

describe('usePlannerState', () => {
    it('restores the dungeon and the picks in link order', () => {
        const { result } = render(`/hubs/7?d=5&c=m12,${UUID_B}#dungeon-planner`);
        expect(result.current.state.instanceId).toBe(5);
        expect(result.current.state.picks.map((p) => p.key)).toEqual(['m12', UUID_B]);
        expect(result.current.state.characterIds).toEqual([UUID_B]);
    });

    it('drops a token not on the roster and rewrites the link once, keeping the hash', () => {
        const { result } = render(`/hubs/7?d=5&c=${STALE},m12#dungeon-planner`);
        expect(result.current.loc.search).toBe('?d=5&c=m12');
        expect(result.current.loc.hash).toBe('#dungeon-planner');
    });

    it('keeps every token while the roster is still loading', () => {
        const { result } = render(`/hubs/7?c=${STALE},m12#dungeon-planner`, null);
        expect(result.current.loc.search).toBe(`?c=${STALE},m12`);
        expect(result.current.state.characterIds).toEqual([STALE]);
    });

    it('adds and removes picks through the URL', () => {
        const { result } = render('/hubs/7#dungeon-planner');
        act(() => result.current.state.setInstanceId(9));
        act(() => result.current.state.add(UUID_A));
        act(() => result.current.state.add('m12'));
        expect(result.current.loc.search).toBe(`?d=9&c=${UUID_A},m12`);
        act(() => result.current.state.remove(UUID_A));
        expect(result.current.state.picks.map((p) => p.key)).toEqual(['m12']);
        expect(result.current.state.available.map((p) => p.key)).toEqual([UUID_A, UUID_B]);
    });

    it('refuses a pick past five', () => {
        const ids = ['m1', 'm2', 'm3', 'm4', 'm5'];
        const many = { classes: [{ class: 'Rogue', count: 6, members: [...ids, 'm6'].map((k) => ({ name: k, characterId: null, level: 10, memberId: Number(k.slice(1)) })) }] };
        const { result } = render(`/hubs/7?c=${ids.join(',')}#dungeon-planner`, many);
        expect(result.current.state.canAdd).toBe(false);
        act(() => result.current.state.add('m6'));
        expect(result.current.state.picks).toHaveLength(5);
    });
});
