/**
 * ROK-1655 — the Start Lineup form's dirty state. `isDirty` compares every
 * editable value with the snapshot taken at mount, so the close guard (wired
 * in the modal) asks before an edit is thrown away and stays quiet otherwise.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStartLineupForm } from './use-start-lineup-dirty';

function setup() {
    return renderHook(() => useStartLineupForm());
}

afterEach(() => {
    vi.useRealTimers();
});

describe('useStartLineupForm — isDirty', () => {
    it('is not dirty at its defaults', () => {
        const { result } = setup();
        expect(result.current.isDirty).toBe(false);
    });

    it('is dirty after a title edit', () => {
        const { result } = setup();
        act(() => result.current.setField('title', 'Friday night games'));
        expect(result.current.isDirty).toBe(true);
    });

    it('is dirty after a visibility change', () => {
        const { result } = setup();
        act(() => result.current.setField('visibility', 'private'));
        expect(result.current.isDirty).toBe(true);
    });

    it('is dirty after an invitee is added', () => {
        const { result } = setup();
        act(() => result.current.setField('inviteeUserIds', [7]));
        expect(result.current.isDirty).toBe(true);
    });

    it('is dirty after a preset is applied', () => {
        const { result } = setup();
        act(() => result.current.applyPreset('tonight'));
        expect(result.current.isDirty).toBe(true);
    });

    it('is dirty after a phase-duration change', () => {
        const { result } = setup();
        act(() => result.current.onBuilding(72));
        expect(result.current.isDirty).toBe(true);
    });

    it('is dirty after the tiebreaker or nomination target changes', () => {
        const { result } = setup();
        act(() => result.current.durations.setTiebreakerMode('veto'));
        expect(result.current.isDirty).toBe(true);
        act(() => result.current.durations.setTiebreakerMode('bracket'));
        act(() => result.current.durations.setNominationTargetPct(60));
        expect(result.current.isDirty).toBe(true);
    });

    it('is dirty after the scheduling-phase toggle flips', () => {
        const { result } = setup();
        act(() => result.current.setField('includeSchedulingPhase', false));
        expect(result.current.isDirty).toBe(true);
    });
});

describe('useStartLineupForm — the mount snapshot', () => {
    it('is clean again when edited values return to their snapshot', () => {
        const { result } = setup();
        const original = result.current.fields.title;
        act(() => result.current.setField('title', 'Something else'));
        act(() => result.current.setField('inviteeUserIds', [7, 9]));
        act(() => result.current.onBuilding(72));
        expect(result.current.isDirty).toBe(true);
        act(() => result.current.setField('title', original));
        act(() => result.current.setField('inviteeUserIds', []));
        // Clearing the duration field falls back to the 48h default.
        act(() => result.current.onBuilding(''));
        expect(result.current.isDirty).toBe(false);
    });

    it('snapshots the time-derived default title once, at mount', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 0, 31, 23, 59));
        const { result, rerender } = setup();
        expect(result.current.fields.title).toBe('Lineup — January 2026');
        vi.setSystemTime(new Date(2026, 1, 1, 0, 1));
        rerender();
        expect(result.current.fields.title).toBe('Lineup — January 2026');
        expect(result.current.isDirty).toBe(false);
    });
});
