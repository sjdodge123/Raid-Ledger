/**
 * Adversarial tests for game-time-slot.utils.ts (ROK-619)
 *
 * The existing test file covers basic toggle scenarios well.
 * This file targets:
 *   - isAllDayActive (entirely untested in the existing suite)
 *   - toggleAllDaySlots edge cases with committed/blocked combinations
 *   - boundary day indices (0, 6, and out-of-range)
 *   - "all 24 available + extra blocked" — should still trigger deselect
 *   - Immutability: original array must not be mutated
 */

import { describe, it, expect } from 'vitest';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { toggleAllDaySlots, isAllDayActive } from './game-time-slot.utils';

// ---------------------------------------------------------------------------
// isAllDayActive — entirely absent from existing tests
// ---------------------------------------------------------------------------

describe('isAllDayActive', () => {
    it('returns false for an empty slot array', () => {
        expect(isAllDayActive([], 0)).toBe(false);
    });

    it('returns false when only some hours are present', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 0, hour: 6, status: 'available' },
            { dayOfWeek: 0, hour: 7, status: 'available' },
        ];
        expect(isAllDayActive(slots, 0)).toBe(false);
    });

    it('returns false when 23 of 24 hours are available', () => {
        const slots: GameTimeSlot[] = Array.from({ length: 23 }, (_, i) => ({
            dayOfWeek: 0, hour: i, status: 'available' as const,
        }));
        expect(isAllDayActive(slots, 0)).toBe(false);
    });

    it('returns true when all 24 available slots are present', () => {
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 0, hour: i, status: 'available' as const,
        }));
        expect(isAllDayActive(slots, 0)).toBe(true);
    });

    it('returns true when slots have no status (treated as available)', () => {
        const slots = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 0, hour: i,
        })) as GameTimeSlot[];
        expect(isAllDayActive(slots, 0)).toBe(true);
    });

    it('returns false when all 24 hours exist but some are committed (not counted as active)', () => {
        const slots: GameTimeSlot[] = [
            ...Array.from({ length: 23 }, (_, i) => ({
                dayOfWeek: 0, hour: i, status: 'available' as const,
            })),
            { dayOfWeek: 0, hour: 23, status: 'committed' as const },
        ];
        // Only 23 available — committed does not count
        expect(isAllDayActive(slots, 0)).toBe(false);
    });

    it('returns false when all 24 hours exist but one is blocked (not counted as active)', () => {
        const slots: GameTimeSlot[] = [
            ...Array.from({ length: 23 }, (_, i) => ({
                dayOfWeek: 0, hour: i, status: 'available' as const,
            })),
            { dayOfWeek: 0, hour: 23, status: 'blocked' as const },
        ];
        expect(isAllDayActive(slots, 0)).toBe(false);
    });

    it('checks the correct day — ignores slots from other days', () => {
        // Day 1 has all 24 hours, but we query day 0
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 1, hour: i, status: 'available' as const,
        }));
        expect(isAllDayActive(slots, 0)).toBe(false);
        expect(isAllDayActive(slots, 1)).toBe(true);
    });

    it('works for the last day index (Saturday = 6)', () => {
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 6, hour: i, status: 'available' as const,
        }));
        expect(isAllDayActive(slots, 6)).toBe(true);
    });

    it('returns false for a mix-status set where available count is exactly 23', () => {
        // 22 available + 1 committed + 1 available (gap at hour 5) = only 22 available
        const slots: GameTimeSlot[] = [
            ...Array.from({ length: 22 }, (_, i) => ({
                dayOfWeek: 0, hour: i + 1, status: 'available' as const, // hours 1-22
            })),
            { dayOfWeek: 0, hour: 23, status: 'committed' as const },
        ];
        expect(isAllDayActive(slots, 0)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// toggleAllDaySlots — adversarial edge cases beyond the existing suite
// ---------------------------------------------------------------------------

describe('toggleAllDaySlots — adversarial edge cases', () => {
    it('does not mutate the original slots array', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 0, hour: 6, status: 'available' },
        ];
        const original = [...slots];
        toggleAllDaySlots(slots, 0);
        expect(slots).toEqual(original);
    });

    it('deselects when all 24 available + extra committed/blocked slots exist', () => {
        // When all 24 available hours are present, toggle deselects them.
        // Committed and blocked must survive.
        const slots: GameTimeSlot[] = [
            ...Array.from({ length: 24 }, (_, i) => ({
                dayOfWeek: 0, hour: i, status: 'available' as const,
            })),
            { dayOfWeek: 0, hour: 5, status: 'committed' as const },
        ];
        const result = toggleAllDaySlots(slots, 0);
        // Available slots removed; committed survives
        const committed = result.filter((s) => s.status === 'committed');
        const available = result.filter((s) => s.dayOfWeek === 0 && (s.status === 'available' || !s.status));
        expect(available).toHaveLength(0);
        expect(committed).toHaveLength(1);
    });

    it('fills to 24 available when some hours have committed slots blocking those positions', () => {
        // hours 0-21 are available, hours 22 and 23 are committed.
        // isAllActive should be false (only 22 available) → should select missing available hours.
        // BUT committed hours already occupy hour 22 and 23, so toggling adds hours 22+23 as "available"
        // only if they don't already exist — they do (as committed), so no new slots added.
        // Result: 22 available + 2 committed = 24 total.
        const slots: GameTimeSlot[] = [
            ...Array.from({ length: 22 }, (_, i) => ({
                dayOfWeek: 0, hour: i, status: 'available' as const,
            })),
            { dayOfWeek: 0, hour: 22, status: 'committed' as const },
            { dayOfWeek: 0, hour: 23, status: 'committed' as const },
        ];
        const result = toggleAllDaySlots(slots, 0);
        // committed slots are preserved
        expect(result.find((s) => s.hour === 22)?.status).toBe('committed');
        expect(result.find((s) => s.hour === 23)?.status).toBe('committed');
        // No new slots added for hours 22/23 because they already exist
        const hour22Slots = result.filter((s) => s.dayOfWeek === 0 && s.hour === 22);
        expect(hour22Slots).toHaveLength(1);
        // Available slots (hours 0-21) remain
        const availableCount = result.filter((s) => s.dayOfWeek === 0 && s.status === 'available').length;
        expect(availableCount).toBe(22);
    });

    it('selects all hours for Saturday (day 6)', () => {
        const result = toggleAllDaySlots([], 6);
        expect(result).toHaveLength(24);
        expect(result.every((s) => s.dayOfWeek === 6)).toBe(true);
    });

    it('deselects all hours for Saturday when all 24 are active', () => {
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 6, hour: i, status: 'available' as const,
        }));
        const result = toggleAllDaySlots(slots, 6);
        expect(result.filter((s) => s.dayOfWeek === 6)).toHaveLength(0);
    });

    it('new slots added during select-all have status "available"', () => {
        const result = toggleAllDaySlots([], 3);
        expect(result.every((s) => s.status === 'available')).toBe(true);
    });

    it('new slots added during select-all have the correct dayIndex', () => {
        const result = toggleAllDaySlots([], 4);
        expect(result.every((s) => s.dayOfWeek === 4)).toBe(true);
    });

    it('returns all 24 hours as a complete set (0-23) when selecting from empty', () => {
        const result = toggleAllDaySlots([], 2);
        const hours = result.map((s) => s.hour).sort((a, b) => a - b);
        expect(hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
    });

    it('slots from other days are never removed during deselect-all', () => {
        const otherDaySlots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 5, hour: i, status: 'available' as const,
        }));
        const targetDaySlots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 2, hour: i, status: 'available' as const,
        }));
        const result = toggleAllDaySlots([...targetDaySlots, ...otherDaySlots], 2);
        // day 2 slots removed; day 5 slots survive
        expect(result.filter((s) => s.dayOfWeek === 2)).toHaveLength(0);
        expect(result.filter((s) => s.dayOfWeek === 5)).toHaveLength(24);
    });
});
