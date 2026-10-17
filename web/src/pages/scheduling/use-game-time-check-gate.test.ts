/**
 * The ONE gate for the game-time check (ROK-1574 / ROK-1569).
 *
 * `hasSlots` drives the copy AND the "Same as last week" answer, so it must
 * mean "has a saved WEEK" — the composite view also carries event-only rows
 * (`fromTemplate: false`) for a viewer who never set a template.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { useGameTimeCheckGate } from './use-game-time-check-gate';

let slots: GameTimeSlot[] = [];

vi.mock('../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: { slots, gameTimeStale: true, gameTimeAgeDays: null } }),
}));

vi.mock('./scheduling-wizard-utils', () => ({
    isWizardSkipped: () => false,
    setWizardSkipped: vi.fn(),
}));

describe('useGameTimeCheckGate — hasSlots means a saved template', () => {
    it('is false when the composite holds only event commitments', () => {
        slots = [{ dayOfWeek: 3, hour: 20, status: 'committed', fromTemplate: false }];
        const { result } = renderHook(() => useGameTimeCheckGate());
        expect(result.current.open).toBe(true);
        expect(result.current.hasSlots).toBe(false);
    });

    it('is true once a template row is present', () => {
        slots = [
            { dayOfWeek: 3, hour: 20, status: 'committed', fromTemplate: false },
            { dayOfWeek: 1, hour: 20, status: 'available', fromTemplate: true },
        ];
        const { result } = renderHook(() => useGameTimeCheckGate());
        expect(result.current.hasSlots).toBe(true);
    });
});
