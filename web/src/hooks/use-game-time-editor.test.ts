import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGameTimeEditor } from './use-game-time-editor';
import React from 'react';

// Mock the dependencies
vi.mock('./use-game-time', () => ({
    useGameTime: vi.fn(() => ({
        data: {
            slots: [],
            events: [],
            weekStart: '2026-02-09',
            overrides: [],
            absences: [],
        },
        isLoading: false,
    })),
    useSaveGameTime: vi.fn(() => ({
        mutateAsync: vi.fn().mockResolvedValue({}),
        isPending: false,
    })),
    useSaveGameTimeOverrides: vi.fn(() => ({
        mutateAsync: vi.fn().mockResolvedValue({}),
        isPending: false,
    })),
}));

vi.mock('../stores/timezone-store', () => ({
    useTimezoneStore: vi.fn((selector) =>
        selector({ resolved: 'America/Los_Angeles' })
    ),
}));

vi.mock('../lib/timezone-utils', () => ({
    getTimezoneAbbr: vi.fn(() => 'PST'),
    getTimezoneOffsetMinutes: vi.fn(() => -480),
}));

vi.mock('../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
    return ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useGameTimeEditor - applyPreset', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Morning Preset (6a-12p)', () => {
        it('adds morning hours (6-11) when none are active', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'morning');

            waitFor(() => {
                const hours = result.current.slots
                    .filter(s => s.dayOfWeek === 0)
                    .map(s => s.hour)
                    .sort((a, b) => a - b);
                expect(hours).toEqual([6, 7, 8, 9, 10, 11]);
            });
        });

        it('removes morning hours when all are active', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            // Add morning hours first
            result.current.applyPreset(0, 'morning');

            waitFor(() => {
                expect(result.current.slots.length).toBeGreaterThan(0);
            });

            // Toggle off
            result.current.applyPreset(0, 'morning');

            waitFor(() => {
                const morningSlots = result.current.slots.filter(
                    s => s.dayOfWeek === 0 && s.hour >= 6 && s.hour < 12
                );
                expect(morningSlots.length).toBe(0);
            });
        });

        it('adds only missing morning hours when some are active', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            // Manually add hours 6 and 7
            result.current.handleChange([
                { dayOfWeek: 0, hour: 6, status: 'available' },
                { dayOfWeek: 0, hour: 7, status: 'available' },
            ]);

            // Apply morning preset
            result.current.applyPreset(0, 'morning');

            waitFor(() => {
                const hours = result.current.slots
                    .filter(s => s.dayOfWeek === 0)
                    .map(s => s.hour)
                    .sort((a, b) => a - b);
                expect(hours).toEqual([6, 7, 8, 9, 10, 11]);
            });
        });
    });

    describe('Afternoon Preset (12p-6p)', () => {
        it('adds afternoon hours (12-17)', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'afternoon');

            waitFor(() => {
                const hours = result.current.slots
                    .filter(s => s.dayOfWeek === 0)
                    .map(s => s.hour)
                    .sort((a, b) => a - b);
                expect(hours).toEqual([12, 13, 14, 15, 16, 17]);
            });
        });

        it('removes afternoon hours when all are active', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'afternoon');
            waitFor(() => expect(result.current.slots.length).toBeGreaterThan(0));

            result.current.applyPreset(0, 'afternoon');

            waitFor(() => {
                const afternoonSlots = result.current.slots.filter(
                    s => s.dayOfWeek === 0 && s.hour >= 12 && s.hour < 18
                );
                expect(afternoonSlots.length).toBe(0);
            });
        });
    });

    describe('Evening Preset (6p-12a)', () => {
        it('adds evening hours (18-23)', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'evening');

            waitFor(() => {
                const hours = result.current.slots
                    .filter(s => s.dayOfWeek === 0)
                    .map(s => s.hour)
                    .sort((a, b) => a - b);
                expect(hours).toEqual([18, 19, 20, 21, 22, 23]);
            });
        });

        it('removes evening hours when all are active', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'evening');
            waitFor(() => expect(result.current.slots.length).toBeGreaterThan(0));

            result.current.applyPreset(0, 'evening');

            waitFor(() => {
                const eveningSlots = result.current.slots.filter(
                    s => s.dayOfWeek === 0 && s.hour >= 18
                );
                expect(eveningSlots.length).toBe(0);
            });
        });
    });

    describe('Night Preset (12a-6a)', () => {
        it('adds night hours (0-5)', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'night');

            waitFor(() => {
                const hours = result.current.slots
                    .filter(s => s.dayOfWeek === 0)
                    .map(s => s.hour)
                    .sort((a, b) => a - b);
                expect(hours).toEqual([0, 1, 2, 3, 4, 5]);
            });
        });

        it('removes night hours when all are active', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'night');
            waitFor(() => expect(result.current.slots.length).toBeGreaterThan(0));

            result.current.applyPreset(0, 'night');

            waitFor(() => {
                const nightSlots = result.current.slots.filter(
                    s => s.dayOfWeek === 0 && s.hour < 6
                );
                expect(nightSlots.length).toBe(0);
            });
        });
    });

    describe('Multiple Presets', () => {
        it('can apply multiple presets to same day', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'morning');
            result.current.applyPreset(0, 'afternoon');

            waitFor(() => {
                const hours = result.current.slots
                    .filter(s => s.dayOfWeek === 0)
                    .map(s => s.hour)
                    .sort((a, b) => a - b);
                expect(hours).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
            });
        });

        it('can apply presets to different days', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'morning'); // Sunday morning
            result.current.applyPreset(1, 'evening'); // Monday evening

            waitFor(() => {
                const sundayHours = result.current.slots
                    .filter(s => s.dayOfWeek === 0)
                    .map(s => s.hour)
                    .sort((a, b) => a - b);
                const mondayHours = result.current.slots
                    .filter(s => s.dayOfWeek === 1)
                    .map(s => s.hour)
                    .sort((a, b) => a - b);

                expect(sundayHours).toEqual([6, 7, 8, 9, 10, 11]);
                expect(mondayHours).toEqual([18, 19, 20, 21, 22, 23]);
            });
        });

        it('does not affect other days when applying preset', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            // Add Monday hours
            result.current.handleChange([
                { dayOfWeek: 1, hour: 10, status: 'available' },
            ]);

            // Apply Sunday morning preset
            result.current.applyPreset(0, 'morning');

            waitFor(() => {
                const mondaySlots = result.current.slots.filter(s => s.dayOfWeek === 1);
                expect(mondaySlots).toHaveLength(1);
                expect(mondaySlots[0].hour).toBe(10);
            });
        });
    });

    describe('Edge Cases', () => {
        it('handles applying preset when other days have slots', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            // Add slots to multiple days
            result.current.handleChange([
                { dayOfWeek: 1, hour: 10, status: 'available' },
                { dayOfWeek: 2, hour: 15, status: 'available' },
            ]);

            // Apply Sunday morning
            result.current.applyPreset(0, 'morning');

            waitFor(() => {
                expect(result.current.slots.filter(s => s.dayOfWeek === 1)).toHaveLength(1);
                expect(result.current.slots.filter(s => s.dayOfWeek === 2)).toHaveLength(1);
                expect(result.current.slots.filter(s => s.dayOfWeek === 0)).toHaveLength(6);
            });
        });

        it('handles toggling preset off with partial overlap', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            // Add all morning hours plus one extra
            result.current.handleChange([
                { dayOfWeek: 0, hour: 6, status: 'available' },
                { dayOfWeek: 0, hour: 7, status: 'available' },
                { dayOfWeek: 0, hour: 8, status: 'available' },
                { dayOfWeek: 0, hour: 9, status: 'available' },
                { dayOfWeek: 0, hour: 10, status: 'available' },
                { dayOfWeek: 0, hour: 11, status: 'available' },
                { dayOfWeek: 0, hour: 14, status: 'available' }, // Extra hour
            ]);

            // Toggle morning off
            result.current.applyPreset(0, 'morning');

            waitFor(() => {
                const remainingSlots = result.current.slots.filter(s => s.dayOfWeek === 0);
                expect(remainingSlots).toHaveLength(1);
                expect(remainingSlots[0].hour).toBe(14);
            });
        });

        it('sets isDirty flag when applying preset', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            expect(result.current.isDirty).toBe(false);

            result.current.applyPreset(0, 'morning');

            waitFor(() => {
                expect(result.current.isDirty).toBe(true);
            });
        });

        it('handles all 7 days (0-6)', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            // Apply morning to all 7 days
            for (let day = 0; day < 7; day++) {
                result.current.applyPreset(day, 'morning');
            }

            waitFor(() => {
                expect(result.current.slots.length).toBe(7 * 6); // 7 days * 6 hours
            });
        });

        it('handles applying all 4 presets to same day (full 24 hours)', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'night');      // 0-5
            result.current.applyPreset(0, 'morning');    // 6-11
            result.current.applyPreset(0, 'afternoon');  // 12-17
            result.current.applyPreset(0, 'evening');    // 18-23

            waitFor(() => {
                const hours = result.current.slots
                    .filter(s => s.dayOfWeek === 0)
                    .map(s => s.hour)
                    .sort((a, b) => a - b);
                expect(hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
            });
        });
    });

    describe('Dirty State Management', () => {
        it('marks editor as dirty after applying preset', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            expect(result.current.isDirty).toBe(false);

            result.current.applyPreset(0, 'morning');

            waitFor(() => {
                expect(result.current.isDirty).toBe(true);
            });
        });

        it('remains dirty after toggling preset off', () => {
            const { result } = renderHook(() => useGameTimeEditor(), {
                wrapper: createWrapper(),
            });

            result.current.applyPreset(0, 'morning');
            waitFor(() => expect(result.current.isDirty).toBe(true));

            result.current.applyPreset(0, 'morning');

            waitFor(() => {
                expect(result.current.isDirty).toBe(true);
            });
        });
    });
});
