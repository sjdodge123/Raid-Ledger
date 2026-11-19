/**
 * ROK-2099 — the Addon errors list: one row per `(addon, message)` group on
 * desktop, one card per group below 1024px, the loading frame, both empty
 * sentences, and a row opening its occurrences + copyable stack.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { AddonErrorGroupDto } from '@raid-ledger/contract';
import { AddonErrorsTable, EMPTY_FILTERED_TEXT, EMPTY_TEXT, type AddonErrorsTableProps } from './addon-errors-table';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));
vi.mock('./use-addon-errors', () => ({
    useAddonErrorDetail: () => ({
        isPending: false, isError: false,
        data: { occurrences: [{ id: 7, member: { userId: 1, username: 'MemberA' }, characterName: 'Charone', characterRealm: 'Realm',
            source: 'buggrabber', sourceVersion: '1', count: 21, firstSeenAt: '2026-11-02T10:00:00Z', lastSeenAt: '2026-11-18T13:49:00Z', stack: 's' }] },
    }),
}));

const sig = (c: string): string => c.repeat(64);
const group = (over: Partial<AddonErrorGroupDto>): AddonErrorGroupDto => ({
    signature: sig('a'), addon: 'Mailworthy', message: "Border.lua:113: attempt to index local 'button' (a nil value)",
    members: [{ userId: 1, username: 'MemberA' }, { userId: 2, username: 'MemberB' }],
    characters: [{ name: 'Charone', realm: 'Realm' }], totalCount: 38,
    firstSeenAt: '2026-11-02T10:00:00Z', lastSeenAt: '2026-11-18T13:49:00Z', sampleStack: 'Border.lua:113: in function <Border.lua:98>',
    ...over,
});
const GROUPS = [group({}), group({ signature: sig('b'), addon: 'Questie', message: 'LibQuestieDB: attempt to index a nil value', members: [{ userId: 3, username: 'MemberC' }], totalCount: 14, sampleStack: null })];

function renderTable(p: Partial<AddonErrorsTableProps> = {}) {
    const onToggle = vi.fn();
    render(<AddonErrorsTable groups={GROUPS} isLoading={false} isError={false} filtered={false} expanded={null} onToggle={onToggle} {...p} />);
    return onToggle;
}

describe('AddonErrorsTable (ROK-2099)', () => {
    beforeEach(() => { media.desktop = true; });

    it('renders one table row per group with addon chip, member count and total count', () => {
        renderTable();
        const rows = screen.getAllByTestId('addon-error-row');
        expect(rows).toHaveLength(2);
        expect(within(rows[0] as HTMLElement).getByTitle('Addon: Mailworthy')).toHaveTextContent('Mailworthy');
        expect(within(rows[0] as HTMLElement).getAllByRole('cell').map((c) => c.textContent).slice(2, 4)).toEqual(['2', '38']);
        expect(within(rows[1] as HTMLElement).getByTitle('Addon: Questie')).toBeInTheDocument();
    });

    it('renders one card per group below 1024px', () => {
        media.desktop = false;
        renderTable();
        expect(screen.queryByRole('table')).toBeNull();
        const cards = screen.getAllByTestId('addon-error-card');
        expect(cards).toHaveLength(2);
        expect(cards[0]).toHaveTextContent('2 members · 38×');
        expect(cards[1]).toHaveTextContent('1 member · 14×');
    });

    it('asks to toggle the clicked group by signature', () => {
        const onToggle = renderTable();
        fireEvent.click(screen.getByRole('button', { name: /LibQuestieDB/ }));
        expect(onToggle).toHaveBeenCalledWith(sig('b'));
    });

    it('an open row shows its occurrences and the stack with a Copy button', () => {
        renderTable({ expanded: sig('a') });
        expect(screen.getByRole('button', { name: /Border\.lua:113/ })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('table', { name: 'Occurrences' })).toHaveTextContent('Charone – Realm');
        expect(screen.getByText('Border.lua:113: in function <Border.lua:98>').tagName).toBe('PRE');
        expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument();
    });

    it('shows the loading frame while the first page loads', () => {
        renderTable({ groups: [], isLoading: true });
        expect(screen.getByText('Loading addon errors…')).toBeInTheDocument();
        expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
    });

    it('shows the §4.5 empty sentence with no errors, and the filtered one under filters', () => {
        renderTable({ groups: [] });
        expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
        renderTable({ groups: [], filtered: true });
        expect(screen.getByText(EMPTY_FILTERED_TEXT)).toBeInTheDocument();
    });

    it('a failed list shows no empty sentence (the page shows the error instead)', () => {
        renderTable({ groups: [], isError: true });
        expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
        expect(screen.queryByText('Loading addon errors…')).toBeNull();
    });

    it('names the table and scopes its headers; aria-controls only while the row is open', () => {
        renderTable({ expanded: sig('a') });
        const table = screen.getByRole('table', { name: 'Addon errors' });
        expect(within(table).getAllByRole('columnheader').every((th) => th.getAttribute('scope') === 'col')).toBe(true);
        expect(screen.getByRole('button', { name: /Border\.lua:113/ })).toHaveAttribute('aria-controls', 'addon-error-aaaaaaaaaaaa');
        expect(screen.getByRole('button', { name: /LibQuestieDB/ })).not.toHaveAttribute('aria-controls');
    });
});
