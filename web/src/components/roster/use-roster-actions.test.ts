/**
 * ROK-2141: roster action toasts must reflect the server outcome — success only
 * after the roster PATCH resolves, an error toast when it rejects.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RosterAssignmentResponse } from '@raid-ledger/contract';

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from '../../lib/toast';
import { useRosterActions } from './use-roster-actions';
import { makePlayer } from './RosterBuilder.test-helpers';

type RosterChange = Parameters<typeof useRosterActions>[0]['onRosterChange'];

function renderActions(pool: RosterAssignmentResponse[], onRosterChange: RosterChange) {
    const announce = vi.fn();
    const hook = renderHook(() => useRosterActions({
        pool, assignments: [], onRosterChange, roleSlots: [],
        getSlotCount: () => 4, isGenericGame: true, announce,
    }));
    return { ...hook, announce };
}

describe('useRosterActions — toast after the roster save settles (ROK-2141)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('does not toast success until onRosterChange resolves', async () => {
        let resolveSave: (ok: boolean) => void = () => undefined;
        const onRosterChange = vi.fn(() => new Promise<boolean>((r) => { resolveSave = r; }));
        const anon = { ...makePlayer(9, null, 'AnonPlayer'), userId: 0 };
        const { result, announce } = renderActions([anon], onRosterChange);
        act(() => { result.current.handleAssignToSlot(9, 'player', 1); });
        expect(onRosterChange).toHaveBeenCalledTimes(1);
        expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
        await act(async () => { resolveSave(true); });
        await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith('AnonPlayer assigned to slot 1'));
        expect(announce).toHaveBeenCalledWith('AnonPlayer assigned to slot 1');
    });

    it('shows an error toast and no success toast when the save rejects', async () => {
        const onRosterChange = vi.fn(() => Promise.reject(new Error('boom')));
        const { result } = renderActions([makePlayer(3, null, 'Bob')], onRosterChange);
        act(() => { result.current.handleAssignToSlot(3, 'player', 2); });
        await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to update roster', expect.anything()));
        expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    it('shows no success toast when the save reports failure (false)', async () => {
        const onRosterChange = vi.fn(() => Promise.resolve(false));
        const { result } = renderActions([makePlayer(4, null, 'Cara')], onRosterChange);
        await act(async () => { result.current.handleAssignToSlot(4, 'player', 1); });
        expect(onRosterChange).toHaveBeenCalledTimes(1);
        expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });
});
