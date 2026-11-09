/**
 * Operator 2026-10-24 — the phone bottom "Your hubs" sheet is larger and its
 * rows easier to read: `GuildRows size="lg"` (64px rows, 40px icon,
 * `text-base` name over `text-sm` meta, `md` kind chip, 20px chevron), a
 * full-width 64px "Browse all hubs" row, a taller cap and a height floor.
 * ROK-2152: a "Popular hubs" section between the viewer's rows and Browse all.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HubDirectoryEntry, MyGuild } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { createMockHubEntry } from '../../../test/handlers/community-hubs';
import { must } from '../../../test/must';
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

const POPULAR: HubDirectoryEntry[] = Array.from({ length: 5 }, (_, i) =>
    createMockHubEntry({ id: 501 + i, name: `Popular ${i + 1}`, memberCount: 20 - i }));

function renderSheet(popular: HubDirectoryEntry[] = [], onClose = vi.fn()): HTMLElement {
    renderWithProviders(<BottomHubsSheet isOpen onClose={onClose} hubs={[hub(1, 'Valheim', 'https://img/v.png'), hub(2, 'Crestless', null)]} popular={popular} />);
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
            expect(classesOf(must(svgs[svgs.length - 1], 'chevron svg')), 'chevron').toEqual(expect.arrayContaining(['h-5', 'w-5']));
        }
        expect(within(must(rows[0], 'first row')).getByText('Member')).toHaveClass('text-sm');
    });

    it('scales the hub image, the shield fallback and the kind chip', () => {
        const sheet = renderSheet();
        expect(classesOf(within(sheet).getByTestId('guild-entry-game-icon'))).toEqual(expect.arrayContaining(['h-10', 'w-10']));
        const crestRow = must(within(sheet).getAllByTestId('guild-entry-row')[1], 'crest row');
        expect(classesOf(must(crestRow.querySelector('[aria-hidden="true"]'), 'shield box')), 'shield fallback box').toEqual(expect.arrayContaining(['h-10', 'w-10']));
        const chip = must(within(sheet).getAllByTestId('hub-kind-chip')[0]?.firstElementChild, 'kind chip');
        expect(classesOf(chip), 'md chip').toEqual(expect.arrayContaining(['text-sm', 'px-2.5', 'py-1']));
    });

    it('"Browse all hubs" is a full-width text-base row at the row height; the sheet is taller with a floor', () => {
        const sheet = renderSheet();
        expect(classesOf(screen.getByTestId('bottom-hubs-browse-all'))).toEqual(expect.arrayContaining(['min-h-[64px]', 'w-full', 'text-base']));
        expect(classesOf(sheet), 'height floor').toContain('min-h-[calc(var(--sheet-vh,1dvh)_*_50)]');
        expect(screen.getByRole('dialog', { name: 'Your hubs' }).style.maxHeight).toBe('880px');
    });
});

describe('BottomHubsSheet — Popular hubs (ROK-2152)', () => {
    it('your lg rows, then the "Popular hubs" heading + 5 lg popular rows, then "Browse all hubs" last', () => {
        const sheet = renderSheet(POPULAR);
        expect(screen.getByRole('dialog', { name: 'Your hubs' }), 'the title stays (Q6)').toContainElement(sheet);
        expect(within(sheet).getAllByTestId('guild-entry-row')).toHaveLength(2);
        const section = within(sheet).getByTestId('popular-hubs-section');
        expect(classesOf(section), 'divided from your rows').toEqual(expect.arrayContaining(['border-t', 'border-edge']));
        expect(within(section).getByTestId('popular-hubs-heading')).toHaveTextContent('Popular hubs');
        const rows = within(section).getAllByTestId('popular-hub-row');
        expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/hubs/501', '/hubs/502', '/hubs/503', '/hubs/504', '/hubs/505']);
        for (const row of rows) {
            expect(row).toHaveAttribute('data-size', 'lg');
            expect(classesOf(row), '64px target').toContain('min-h-[64px]');
        }
        const ownLast = must(within(sheet).getAllByTestId('guild-entry-row')[1], 'last own row');
        expect(ownLast.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING, 'popular follows your rows').toBeTruthy();
        const browse = screen.getByTestId('bottom-hubs-browse-all');
        expect(section.compareDocumentPosition(browse) & Node.DOCUMENT_POSITION_FOLLOWING, 'Browse all is last').toBeTruthy();
    });

    it('no popular hubs → no section', () => {
        const sheet = renderSheet([]);
        expect(within(sheet).queryByTestId('popular-hubs-section')).not.toBeInTheDocument();
        expect(sheet).not.toHaveTextContent('Popular hubs');
    });

    it('picking a popular row closes the sheet', async () => {
        const onClose = vi.fn();
        const sheet = renderSheet(POPULAR, onClose);
        await userEvent.click(must(within(sheet).getAllByTestId('popular-hub-row')[0], 'first popular row'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
