/**
 * ROK-1899 — the detail footer's layout: ONE row of a fixed-width Amount box
 * then "Add to list" filling the rest (approved mockup; spec §3.3), with the
 * UPGRADE quality picker on its own line above.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CraftDetailFooter, type CraftDetailFooterProps } from './craft-detail-footer';
import { CRAFT_ENTRIES } from './crafting.test-fixture';

function must<T>(value: T | null | undefined, label: string): T {
    if (value === null || value === undefined) throw new Error(`missing ${label}`);
    return value;
}

function renderFooter(over: Partial<CraftDetailFooterProps> = {}): void {
    const entry = must(CRAFT_ENTRIES[0], 'entry');
    render(<CraftDetailFooter mode="craft" entry={entry} quality={1} onQuality={vi.fn()} onAdd={vi.fn(() => true)} atCap={false}
        amount="1" onAmount={vi.fn()} {...over} />);
}

describe('CraftDetailFooter layout', () => {
    it('puts a fixed-width Amount box and a filling "Add to list" in one row', () => {
        renderFooter();
        const input = screen.getByRole('spinbutton', { name: 'Amount' });
        const button = screen.getByRole('button', { name: 'Add to list' });
        const box = must(input.parentElement, 'amount box');
        const row = must(box.parentElement, 'footer row');
        expect(button.parentElement, 'the button shares the Amount box row').toBe(row);
        expect(row.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'items-center']));
        expect(row.className.split(' '), 'the row never wraps the button under the box').not.toContain('flex-wrap');
        expect(box.className.split(' ')).toEqual(expect.arrayContaining(['w-18', 'lg:w-21', 'shrink-0']));
        expect(button.className.split(' ')).toEqual(expect.arrayContaining(['flex-1', 'min-h-[44px]']));
    });

    it('UPGRADE keeps the quality picker out of the Amount/button row', () => {
        const axe = must(CRAFT_ENTRIES.find((e) => e.upgrades.length > 0), 'upgradable entry');
        renderFooter({ mode: 'upgrade', entry: axe, quality: 2 });
        const row = must(screen.getByRole('button', { name: 'Add to list' }).parentElement, 'footer row');
        expect(row.contains(screen.getByRole('combobox', { name: 'Upgrade to quality' }))).toBe(false);
        expect(row.contains(screen.getByRole('spinbutton', { name: 'Amount' }))).toBe(true);
    });
});
