/**
 * Operator 2026-10-24 — the phone bottom "Your hubs" sheet is larger and its
 * rows easier to read: `GuildRows size="lg"` (64px rows, 40px icon,
 * `text-base` name over `text-sm` meta, `md` kind chip, 20px chevron), a
 * full-width 64px "Browse all hubs" row, a taller cap and a height floor.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { MyGuild } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import BottomHubsSheet from './bottom-hubs-sheet';

vi.mock('../../ui/bottom-sheet-viewport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../ui/bottom-sheet-viewport')>()),
    useVisibleViewport: () => ({ height: 1000, offsetTop: 0 }),
}));

function hub(id: number, name: string, gameIconUrl: string | null): MyGuild {
    return {
        id, gameId: 7, kind: 'game_server', name, region: 'us', realmSlug: null, realmName: null, faction: null,
        memberCount: 3, lastSnapshotAt: null, rankIndex: null, rankName: 'Member', canEdit: false, gmPostHeadline: null, gameIconUrl,
    };
}

function classesOf(el: Element): string[] { return (el.getAttribute('class') ?? '').split(/\s+/); }

function renderSheet(): HTMLElement {
    renderWithProviders(<BottomHubsSheet isOpen onClose={vi.fn()} hubs={[hub(1, 'Valheim', 'https://img/v.png'), hub(2, 'Crestless', null)]} />);
    return screen.getByTestId('bottom-hubs-sheet');
}

describe('BottomHubsSheet — larger rows (operator 2026-10-24)', () => {
    it('renders the lg rows: 64px, text-base name, text-sm meta, 20px chevron', () => {
        const sheet = renderSheet();
        const rows = within(sheet).getAllByTestId('guild-entry-row');
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row).toHaveAttribute('data-size', 'lg');
            expect(classesOf(row), 'lg row height + type').toEqual(expect.arrayContaining(['min-h-[64px]', 'text-base', 'px-5']));
            expect(classesOf(row)).not.toContain('text-sm');
            const svgs = row.querySelectorAll('svg');
            expect(classesOf(svgs[svgs.length - 1] ?? row), 'chevron').toEqual(expect.arrayContaining(['h-5', 'w-5']));
        }
        expect(within(rows[0] ?? sheet).getByText('Member')).toHaveClass('text-sm');
    });

    it('scales the hub image, the shield fallback and the kind chip', () => {
        const sheet = renderSheet();
        expect(classesOf(within(sheet).getByTestId('guild-entry-game-icon'))).toEqual(expect.arrayContaining(['h-10', 'w-10']));
        const crestRow = within(sheet).getAllByTestId('guild-entry-row')[1] ?? sheet;
        expect(classesOf(crestRow.querySelector('[aria-hidden="true"]') ?? crestRow), 'shield fallback box').toEqual(expect.arrayContaining(['h-10', 'w-10']));
        const chip = within(sheet).getAllByTestId('hub-kind-chip')[0]?.firstElementChild ?? sheet;
        expect(classesOf(chip), 'md chip').toEqual(expect.arrayContaining(['text-sm', 'px-2.5', 'py-1']));
    });

    it('"Browse all hubs" is a full-width text-base row at the row height; the sheet is taller with a floor', () => {
        const sheet = renderSheet();
        expect(classesOf(screen.getByTestId('bottom-hubs-browse-all'))).toEqual(expect.arrayContaining(['min-h-[64px]', 'w-full', 'text-base']));
        expect(classesOf(sheet), 'height floor').toContain('min-h-[calc(var(--sheet-vh,1dvh)_*_50)]');
        expect(screen.getByRole('dialog', { name: 'Your hubs' }).style.maxHeight).toBe('880px');
    });
});
