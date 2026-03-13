/**
 * Adversarial tests for DaySection and GameTimeMobileEditor (ROK-619)
 *
 * Existing tests cover the happy path for All Day button.
 * This file targets:
 *   - isAllActive: `activeSet.size === 24` — tests where 24 slots exist but
 *     some are blocked/committed (should NOT appear active)
 *   - All Day button visibility: onAllDay provided but readOnly (should hide)
 *   - All Day button for non-Sunday days via GameTimeMobileEditor
 *   - DaySection with committed+blocked but <24 available does NOT show active style
 *   - GameTimeMobileEditor: All Day preserves committed/blocked slots
 *   - GameTimeMobileEditor: All Day on non-Sunday (day 5 = Friday) passes correct dayIndex
 *   - DaySection: All Day called once per click (no double-fire)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DaySection } from './DaySection';
import { GameTimeMobileEditor } from './GameTimeMobileEditor';
import type { GameTimeSlot } from '@raid-ledger/contract';

// ---------------------------------------------------------------------------
// DaySection adversarial tests
// ---------------------------------------------------------------------------

describe('DaySection — All Day button active-state edge cases (ROK-619)', () => {
    const base = {
        expanded: true,
        onToggle: vi.fn(),
        onHourToggle: vi.fn(),
        onPreset: vi.fn(),
        onAllDay: vi.fn(),
    };

    afterEach(cleanup);
    beforeEach(() => vi.clearAllMocks());

    it('All Day button shows inactive when 24 slots exist but some are committed (not truly all-day active)', () => {
        // activeSet only counts available/no-status — committed does not count.
        // 23 available + 1 committed → activeSet.size === 23, not 24 → inactive style.
        const slots: GameTimeSlot[] = [
            ...Array.from({ length: 23 }, (_, i) => ({
                dayOfWeek: 0, hour: i, status: 'available' as const,
            })),
            { dayOfWeek: 0, hour: 23, status: 'committed' as const },
        ];
        render(<DaySection {...base} dayIndex={0} slots={slots} />);
        const btn = screen.getByRole('button', { name: /All Day/i });
        expect(btn.className).not.toContain('bg-emerald-600');
    });

    it('All Day button shows inactive when 24 slots exist but one is blocked', () => {
        const slots: GameTimeSlot[] = [
            ...Array.from({ length: 23 }, (_, i) => ({
                dayOfWeek: 0, hour: i, status: 'available' as const,
            })),
            { dayOfWeek: 0, hour: 23, status: 'blocked' as const },
        ];
        render(<DaySection {...base} dayIndex={0} slots={slots} />);
        const btn = screen.getByRole('button', { name: /All Day/i });
        expect(btn.className).not.toContain('bg-emerald-600');
    });

    it('All Day button shows active when all 24 slots are available (no status)', () => {
        const slots = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 0, hour: i,
        })) as GameTimeSlot[];
        render(<DaySection {...base} dayIndex={0} slots={slots} />);
        const btn = screen.getByRole('button', { name: /All Day/i });
        expect(btn.className).toContain('bg-emerald-600');
    });

    it('All Day button fires exactly once per click', () => {
        const onAllDay = vi.fn();
        render(<DaySection {...base} onAllDay={onAllDay} dayIndex={0} slots={[]} />);
        const btn = screen.getByRole('button', { name: /All Day/i });
        fireEvent.click(btn);
        expect(onAllDay).toHaveBeenCalledTimes(1);
        expect(onAllDay).toHaveBeenCalledWith(0);
    });

    it('All Day button hidden when expanded=false even if onAllDay provided', () => {
        render(<DaySection {...base} expanded={false} dayIndex={0} slots={[]} />);
        expect(screen.queryByRole('button', { name: /All Day/i })).not.toBeInTheDocument();
    });

    it('All Day button hidden when readOnly even if onAllDay provided', () => {
        render(<DaySection {...base} readOnly dayIndex={0} slots={[]} />);
        expect(screen.queryByRole('button', { name: /All Day/i })).not.toBeInTheDocument();
    });

    it('All Day button passes correct dayIndex (Saturday = 6)', () => {
        const onAllDay = vi.fn();
        render(<DaySection {...base} onAllDay={onAllDay} dayIndex={6} slots={[]} />);
        fireEvent.click(screen.getByRole('button', { name: /All Day/i }));
        expect(onAllDay).toHaveBeenCalledWith(6);
    });

    it('All Day button passes correct dayIndex (Wednesday = 3)', () => {
        const onAllDay = vi.fn();
        render(<DaySection {...base} onAllDay={onAllDay} dayIndex={3} slots={[]} />);
        fireEvent.click(screen.getByRole('button', { name: /All Day/i }));
        expect(onAllDay).toHaveBeenCalledWith(3);
    });

    it('slots from other days do not affect the isAllActive calculation', () => {
        // Day 0 has only 1 hour, but day 1 has all 24 — active state should still be false for day 0
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 0, hour: 6, status: 'available' },
            ...Array.from({ length: 24 }, (_, i) => ({
                dayOfWeek: 1, hour: i, status: 'available' as const,
            })),
        ];
        render(<DaySection {...base} dayIndex={0} slots={slots} />);
        const btn = screen.getByRole('button', { name: /All Day/i });
        expect(btn.className).not.toContain('bg-emerald-600');
    });
});

// ---------------------------------------------------------------------------
// GameTimeMobileEditor adversarial tests
// ---------------------------------------------------------------------------

describe('GameTimeMobileEditor — All Day on non-Sunday days (ROK-619)', () => {
    const onChange = vi.fn();

    beforeEach(() => { vi.clearAllMocks(); });
    afterEach(cleanup);

    function expandDay(dayName: string) {
        const header = screen.getByText(dayName).closest('button')!;
        fireEvent.click(header);
    }

    it('All Day on Friday (index 5) selects dayOfWeek=5 slots', () => {
        render(<GameTimeMobileEditor slots={[]} onChange={onChange} />);
        expandDay('Friday');
        fireEvent.click(screen.getByRole('button', { name: /All Day/i }));
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result).toHaveLength(24);
        expect(result.every((s) => s.dayOfWeek === 5)).toBe(true);
    });

    it('All Day on Saturday (index 6) selects dayOfWeek=6 slots', () => {
        render(<GameTimeMobileEditor slots={[]} onChange={onChange} />);
        expandDay('Saturday');
        fireEvent.click(screen.getByRole('button', { name: /All Day/i }));
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result).toHaveLength(24);
        expect(result.every((s) => s.dayOfWeek === 6)).toBe(true);
    });

    it('All Day deselects on Thursday when all 24 are active', () => {
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 4, hour: i, status: 'available' as const,
        }));
        render(<GameTimeMobileEditor slots={slots} onChange={onChange} />);
        expandDay('Thursday');
        fireEvent.click(screen.getByRole('button', { name: /All Day/i }));
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result.filter((s) => s.dayOfWeek === 4)).toHaveLength(0);
    });
});

describe('GameTimeMobileEditor — All Day preserves committed/blocked (ROK-619)', () => {
    const onChange = vi.fn();

    beforeEach(() => { vi.clearAllMocks(); });
    afterEach(cleanup);

    it('All Day select-all does not overwrite committed slots (no duplicate hour entries)', () => {
        // Hours 22+23 are committed; All Day should not add a second "available" entry for them
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 0, hour: 22, status: 'committed' as const },
            { dayOfWeek: 0, hour: 23, status: 'committed' as const },
        ];
        render(<GameTimeMobileEditor slots={slots} onChange={onChange} />);
        const sundayHeader = screen.getByText('Sunday').closest('button')!;
        fireEvent.click(sundayHeader);
        fireEvent.click(screen.getByRole('button', { name: /All Day/i }));

        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        const hour22Slots = result.filter((s) => s.dayOfWeek === 0 && s.hour === 22);
        const hour23Slots = result.filter((s) => s.dayOfWeek === 0 && s.hour === 23);
        // Only one slot per hour (committed slot preserved, not duplicated)
        expect(hour22Slots).toHaveLength(1);
        expect(hour23Slots).toHaveLength(1);
        expect(hour22Slots[0].status).toBe('committed');
        expect(hour23Slots[0].status).toBe('committed');
    });

    it('All Day deselect removes only available slots, committed survive', () => {
        // All 24 available, plus one committed at hour 5 (duplicate hour position)
        const slots: GameTimeSlot[] = [
            ...Array.from({ length: 24 }, (_, i) => ({
                dayOfWeek: 0, hour: i, status: 'available' as const,
            })),
            { dayOfWeek: 0, hour: 5, status: 'committed' as const },
        ];
        render(<GameTimeMobileEditor slots={slots} onChange={onChange} />);
        const sundayHeader = screen.getByText('Sunday').closest('button')!;
        fireEvent.click(sundayHeader);
        fireEvent.click(screen.getByRole('button', { name: /All Day/i }));

        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        const committedSlots = result.filter((s) => s.status === 'committed');
        const availableSlots = result.filter((s) => s.dayOfWeek === 0 && (s.status === 'available' || !s.status));
        expect(committedSlots).toHaveLength(1);
        expect(availableSlots).toHaveLength(0);
    });

    it('All Day in readOnly mode does not call onChange', () => {
        render(<GameTimeMobileEditor slots={[]} onChange={onChange} readOnly />);
        const sundayHeader = screen.getByText('Sunday').closest('button')!;
        fireEvent.click(sundayHeader);
        // All Day button should not be present in readOnly mode
        expect(screen.queryByRole('button', { name: /All Day/i })).not.toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('GameTimeMobileEditor — All Day interaction with presets (ROK-619)', () => {
    const onChange = vi.fn();

    beforeEach(() => { vi.clearAllMocks(); });
    afterEach(cleanup);

    it('All Day selects all hours even when a preset was previously applied', () => {
        // Morning preset (hours 6-11) already selected
        const slots: GameTimeSlot[] = Array.from({ length: 6 }, (_, i) => ({
            dayOfWeek: 0, hour: i + 6, status: 'available' as const,
        }));
        render(<GameTimeMobileEditor slots={slots} onChange={onChange} />);
        const sundayHeader = screen.getByText('Sunday').closest('button')!;
        fireEvent.click(sundayHeader);
        fireEvent.click(screen.getByRole('button', { name: /All Day/i }));

        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        const hours = result.filter((s) => s.dayOfWeek === 0).map((s) => s.hour).sort((a, b) => a - b);
        expect(hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
    });

    it('All Day after deselect shows correct count (24h selected)', () => {
        // We verify the DaySection header shows 24h selected after all slots are set
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 0, hour: i, status: 'available' as const,
        }));
        render(<GameTimeMobileEditor slots={slots} onChange={onChange} />);
        // Before expanding, the header shows 24h selected
        expect(screen.getByText('24h selected')).toBeInTheDocument();
    });
});
