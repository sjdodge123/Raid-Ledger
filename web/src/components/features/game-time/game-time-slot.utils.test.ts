import { describe, it, expect } from 'vitest';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { toggleAllDaySlots } from './game-time-slot.utils';

describe('toggleAllDaySlots — basic toggle', () => {
    it('selects all 24 hours when day is empty', () => {
        const result = toggleAllDaySlots([], 0);
        expect(result).toHaveLength(24);
        const hours = result.map((s) => s.hour).sort((a, b) => a - b);
        expect(hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
        expect(result.every((s) => s.dayOfWeek === 0 && s.status === 'available')).toBe(true);
    });

    it('deselects all hours when all 24 are already available', () => {
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 0, hour: i, status: 'available' as const,
        }));
        const result = toggleAllDaySlots(slots, 0);
        expect(result).toHaveLength(0);
    });

    it('fills missing hours when some are already selected', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 0, hour: 6, status: 'available' },
            { dayOfWeek: 0, hour: 7, status: 'available' },
        ];
        const result = toggleAllDaySlots(slots, 0);
        expect(result).toHaveLength(24);
        const hours = result.map((s) => s.hour).sort((a, b) => a - b);
        expect(hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
    });

    it('deselects for a specific day index', () => {
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 3, hour: i, status: 'available' as const,
        }));
        const result = toggleAllDaySlots(slots, 3);
        expect(result).toHaveLength(0);
    });
});

describe('toggleAllDaySlots — edge cases', () => {
    it('preserves slots from other days', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 1, hour: 10, status: 'available' },
            { dayOfWeek: 2, hour: 15, status: 'available' },
        ];
        const result = toggleAllDaySlots(slots, 0);
        expect(result).toHaveLength(26);
        expect(result.filter((s) => s.dayOfWeek === 1)).toHaveLength(1);
        expect(result.filter((s) => s.dayOfWeek === 2)).toHaveLength(1);
    });

    it('clears available slots but preserves committed/blocked when all toggleable hours are active', () => {
        const slots: GameTimeSlot[] = [
            ...Array.from({ length: 22 }, (_, i) => ({
                dayOfWeek: 0, hour: i, status: 'available' as const,
            })),
            { dayOfWeek: 0, hour: 22, status: 'committed' as const },
            { dayOfWeek: 0, hour: 23, status: 'blocked' as const },
        ];
        const result = toggleAllDaySlots(slots, 0);
        // All toggleable hours (0-21) were active → cleared. Committed/blocked preserved.
        expect(result).toHaveLength(2);
        expect(result.find((s) => s.hour === 22)?.status).toBe('committed');
        expect(result.find((s) => s.hour === 23)?.status).toBe('blocked');
    });

    it('treats slots with no status as available', () => {
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 0, hour: i,
        })) as GameTimeSlot[];
        const result = toggleAllDaySlots(slots, 0);
        expect(result).toHaveLength(0);
    });
});
