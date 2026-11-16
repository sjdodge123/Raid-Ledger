/**
 * ROK-2216 U5 — the planner's group row: chips in pick order, unclaimed rows
 * greyed "no quest data", and a sixth pick refused.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChips, type GroupChipsState } from './character-picker';
import { rosterPicks, type RosterPick } from './planner-roster';
import { ROSTER, UUID_A, UUID_B } from './planner-roster.fixtures';

function must<T>(value: T | undefined, label: string): T {
    if (value === undefined) throw new Error(`missing ${label}`);
    return value;
}

const OPTIONS = rosterPicks(ROSTER);
const byKey = (key: string): RosterPick => must(OPTIONS.find((o) => o.key === key), key);
const TANKY = byKey(UUID_A);
const BLINKY = byKey(UUID_B);
const ALT = byKey('m12');

function state(picks: RosterPick[], over: Partial<GroupChipsState> = {}): GroupChipsState {
    return {
        picks, canAdd: picks.length < 5, add: vi.fn(), remove: vi.fn(),
        available: OPTIONS.filter((o) => !picks.includes(o)), ...over,
    };
}

function chipOrder(): string[] {
    return screen.getAllByRole('button', { name: /^Remove / }).map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
}

describe('GroupChips', () => {
    it('keeps the chips in pick order', () => {
        render(<GroupChips s={state([BLINKY, ALT, TANKY])} belowRange={new Set()} dropped={new Set()} />);
        expect(chipOrder()).toEqual(['Remove Blinky', 'Remove Alt', 'Remove Tanky']);
    });

    it('marks an unclaimed pick "no quest data" and a below-range pick with ⚠', () => {
        render(<GroupChips s={state([TANKY, ALT])} belowRange={new Set([TANKY.key])} dropped={new Set()} />);
        expect(screen.getByText(/Lv20 ⚠/)).toBeInTheDocument();
        expect(screen.getByText(/Lv18 · no quest data/)).toBeInTheDocument();
    });

    it('greys a claimed pick the plan API dropped as no longer on the roster', () => {
        render(<GroupChips s={state([BLINKY])} belowRange={new Set()} dropped={new Set([BLINKY.key])} />);
        expect(screen.getByText(/no longer on the roster/)).toBeInTheDocument();
    });

    it('lists unclaimed roster rows as "no quest data" and adds the picked row by key', async () => {
        const s = state([TANKY]);
        render(<GroupChips s={s} belowRange={new Set()} dropped={new Set()} />);
        await userEvent.click(screen.getByRole('button', { name: '+ Add character (4 left)' }));
        const alt = await screen.findByRole('option', { name: /Alt/ });
        expect(alt).toHaveTextContent('no quest data');
        await userEvent.click(alt);
        expect(s.add).toHaveBeenCalledWith('m12');
    });

    it('refuses a sixth pick: no add button, a "group full" hint instead', () => {
        const five = [TANKY, BLINKY, ALT, byKey('m12'), TANKY].map((p, i) => ({ ...p, key: `${p.key}-${i}` }));
        render(<GroupChips s={state(five, { canAdd: false })} belowRange={new Set()} dropped={new Set()} />);
        expect(screen.queryByRole('button', { name: /Add character/ })).toBeNull();
        expect(screen.getByText('Group full (5/5) — remove someone to add another.')).toBeInTheDocument();
    });
});
