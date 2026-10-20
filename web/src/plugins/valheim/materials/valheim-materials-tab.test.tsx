/** ROK-1853 — the hub Materials tab: totals, search, vehicles toggle, personal, empty, warnings, drill-down. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    VALHEIM_CONTAINERS_URL,
    VALHEIM_MATERIALS_URL,
    chestShared,
    chestSharedDetail,
    containersFixture,
    materialsEmpty,
    materialsFixture,
    valheimContainerHandler,
    valheimContainersHandler,
    valheimMaterialsHandler,
} from '../../../test/mocks/valheim-materials-handlers';
import { MATERIALS_EMPTY_COPY } from './materials.helpers';
import { ValheimMaterialsTab } from './valheim-materials-tab';

const media = vi.hoisted(() => ({ desktop: false }));
vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: () => media.desktop,
}));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const renderTab = () =>
    renderWithProviders(<ValheimMaterialsTab serverId={7} />);
const sharedList = () =>
    screen.findByRole('list', { name: 'Shared chest totals' });

beforeEach(() => {
    media.desktop = false;
    server.use(valheimContainersHandler(), valheimContainerHandler());
});

describe('ValheimMaterialsTab', () => {
    it('renders shared totals named from the catalogue, with the scan age', async () => {
        const hits: string[] = [];
        server.use(valheimMaterialsHandler(materialsFixture(), hits));
        renderTab();
        const list = await sharedList();
        expect(
            within(list)
                .getAllByRole('listitem')
                .map((li) => li.textContent),
        ).toEqual([
            expect.stringContaining('Wood'),
            expect.stringContaining('Stone'),
            expect.stringContaining('Iron sword'),
        ]);
        expect(within(list).getByText(/^q1 ×1 · q2 ×3 ·/)).toHaveTextContent(
            'q1 ×1 · q2 ×3 · ≥ 1 chest',
        );
        expect(
            screen.getByTestId('valheim-materials-scan-age'),
        ).toHaveTextContent('Scanned 7 min ago');
        expect(hits[0]).toBe('?includeVehicles=true');
    });

    it('search narrows the rows by name', async () => {
        server.use(valheimMaterialsHandler(materialsFixture()));
        renderTab();
        const list = await sharedList();
        await userEvent.type(
            screen.getByRole('searchbox', { name: 'Search materials' }),
            'iron',
        );
        await waitFor(() =>
            expect(within(list).getAllByRole('listitem')).toHaveLength(1),
        );
        expect(within(list).getByText('Iron sword')).toBeInTheDocument();
    });

    it('the vehicles switch refetches with includeVehicles=false', async () => {
        const hits: string[] = [];
        server.use(valheimMaterialsHandler(materialsFixture(), hits));
        renderTab();
        await sharedList();
        await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
        const toggle = screen.getByRole('switch', {
            name: 'Include carts and ships',
        });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        await userEvent.click(toggle);
        await waitFor(() => expect(hits).toContain('?includeVehicles=false'));
    });

    it('hides the personal section when personal is null, shows it with omittedPrivate otherwise', async () => {
        server.use(valheimMaterialsHandler(materialsFixture()));
        const first = renderTab();
        await sharedList();
        expect(
            screen.queryByRole('heading', { name: 'Personal chests' }),
        ).not.toBeInTheDocument();
        first.unmount();
        const personal = {
            totals: [{ prefab: 'Coins', quality: 1, total: 99, chests: 1 }],
            chestCount: 1,
            omittedPrivate: 2,
        };
        server.use(valheimMaterialsHandler(materialsFixture({ personal })));
        renderTab();
        expect(
            await screen.findByRole('heading', { name: 'Personal chests' }),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/2 personal chests not scanned/),
        ).toBeInTheDocument();
        expect(
            within(
                screen.getByRole('list', { name: 'Personal chest totals' }),
            ).getByText('Coins'),
        ).toBeInTheDocument();
    });

    it('shows the empty state when the server has sent no scan', async () => {
        server.use(valheimMaterialsHandler(materialsEmpty));
        renderTab();
        expect(
            await screen.findByText(MATERIALS_EMPTY_COPY),
        ).toBeInTheDocument();
    });

    it('shows the warning banner and an error state', async () => {
        const warnings = { unreadable: 2, omittedEntries: 0, omittedShared: 1 };
        server.use(
            valheimMaterialsHandler(
                materialsFixture({
                    shared: { ...materialsFixture().shared, warnings },
                }),
            ),
        );
        const first = renderTab();
        const banner = await screen.findByRole('status');
        expect(banner).toHaveTextContent('2 chests could not be read');
        expect(banner).toHaveTextContent('1 chest was not scanned');
        first.unmount();
        server.use(
            http.get(VALHEIM_MATERIALS_URL, () =>
                HttpResponse.json({ message: 'boom' }, { status: 500 }),
            ),
        );
        renderTab();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Couldn’t load materials',
        );
    });

    it('opens a chest from the list and shows its stacks', async () => {
        server.use(valheimMaterialsHandler(materialsFixture()));
        renderTab();
        const chests = await screen.findByRole('list', { name: 'Chests' });
        expect(within(chests).getByText(/x 120, z −340/)).toBeInTheDocument();
        expect(within(chests).getByText('Vehicle')).toBeInTheDocument();
        await userEvent.click(
            within(chests).getByRole('button', { name: /Wood chest/ }),
        );
        const contents = await screen.findByRole('list', {
            name: 'Chest contents',
        });
        expect(within(contents).getAllByRole('listitem')).toHaveLength(2);
        expect(
            within(contents).getByRole('button', { name: /Iron sword/ }),
        ).toBeInTheDocument();
    });

    it('sorts the desktop table from its header buttons', async () => {
        media.desktop = true;
        server.use(valheimMaterialsHandler(materialsFixture()));
        renderTab();
        const table = await screen.findByRole('table', {
            name: 'Shared chest totals',
        });
        const names = () =>
            within(table)
                .getAllByRole('row')
                .slice(1)
                .map((r) => r.querySelector('td')?.textContent);
        expect(names()[0]).toContain('Wood');
        await userEvent.click(
            within(table).getByRole('button', { name: /Item/ }),
        );
        expect(
            within(table).getByRole('columnheader', { name: /Item/ }),
        ).toHaveAttribute('aria-sort', 'ascending');
        expect(names()[0]).toContain('Iron sword');
    });
    it('phone: a split-quality chest count is a lower bound; one quality stays exact', async () => {
        server.use(valheimMaterialsHandler(materialsFixture()));
        renderTab();
        const list = await sharedList();
        const [wood, , sword] = within(list).getAllByRole('listitem');
        expect(wood?.textContent).toContain('×1,240 · 2 chests');
        expect(wood?.textContent).not.toContain('≥');
        expect(sword?.textContent).toContain('≥ 1 chest');
        const bound = within(list).getByText(
            'at least 1 chest (counted per quality)',
        );
        expect(bound.parentElement).toHaveAttribute(
            'title',
            'at least 1 chest (counted per quality)',
        );
    });

    it('desktop: lower-bound chest cell, exact single-quality cell, sole q3 labelled', async () => {
        media.desktop = true;
        const base = materialsFixture();
        const shared = {
            ...base.shared,
            totals: [
                ...base.shared.totals,
                { prefab: 'Coins', quality: 3, total: 5, chests: 1 },
            ],
        };
        server.use(valheimMaterialsHandler(materialsFixture({ shared })));
        renderTab();
        const table = await screen.findByRole('table', {
            name: 'Shared chest totals',
        });
        const rowOf = (name: string) =>
            within(table).getByRole('row', { name: new RegExp(name) });
        const cells = (name: string) =>
            within(rowOf(name)).getAllByRole('cell');
        expect(cells('Wood')[2]?.textContent).toBe('2');
        expect(cells('Iron sword')[2]?.textContent).toBe(
            '≥ 1at least 1 chest (counted per quality)',
        );
        expect(cells('Coins')[1]).toHaveTextContent('5q3 ×5');
        expect(cells('Coins')[2]?.textContent).toBe('1');
    });

    it('a category only personal chests hold is selectable and filters the personal section', async () => {
        const personal = {
            totals: [
                { prefab: 'Coins', quality: 1, total: 99, chests: 1 },
                { prefab: 'Wood', quality: 1, total: 4, chests: 1 },
            ],
            chestCount: 1,
            omittedPrivate: null,
        };
        server.use(valheimMaterialsHandler(materialsFixture({ personal })));
        renderTab();
        await sharedList();
        await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
        const select = screen.getByRole('combobox', { name: 'Category' });
        expect(
            within(select)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toContain('Valuable');
        await userEvent.selectOptions(select, 'Valuable');
        const mine = screen.getByRole('list', {
            name: 'Personal chest totals',
        });
        await waitFor(() =>
            expect(
                within(mine)
                    .getAllByRole('listitem')
                    .map((li) => li.textContent),
            ).toEqual([expect.stringContaining('Coins')]),
        );
    });

    describe('item → chests drill-down (Codex r2)', () => {
        /** `?prefab=Wood` answers the one chest holding it; records each query. */
        function drillHandler(hits: string[]) {
            return http.get(VALHEIM_CONTAINERS_URL, ({ request }) => {
                const url = new URL(request.url);
                hits.push(url.search);
                const prefab = url.searchParams.get('prefab');
                return HttpResponse.json(
                    containersFixture(
                        prefab === null ? undefined : [chestShared],
                    ),
                );
            });
        }
        const woodToggle = async () =>
            within(await sharedList()).getByRole('button', { name: /Wood/ });

        it('phone: a row click selects the item, refetches with prefab=, and Clear resets', async () => {
            const hits: string[] = [];
            server.use(
                valheimMaterialsHandler(materialsFixture()),
                drillHandler(hits),
            );
            renderTab();
            const wood = await woodToggle();
            expect(wood).toHaveAttribute('aria-pressed', 'false');
            await userEvent.click(wood);
            expect(wood).toHaveAttribute('aria-pressed', 'true');
            await waitFor(() =>
                expect(hits).toContain('?includeVehicles=true&prefab=Wood'),
            );
            expect(
                screen.getByTestId('valheim-chests-holding'),
            ).toHaveTextContent('Chests holding Wood');
            const chests = await screen.findByRole('list', { name: 'Chests' });
            await waitFor(() =>
                expect(within(chests).getAllByRole('listitem')).toHaveLength(1),
            );
            await userEvent.click(
                screen.getByRole('button', { name: 'Clear' }),
            );
            expect(wood).toHaveAttribute('aria-pressed', 'false');
            expect(
                screen.queryByTestId('valheim-chests-holding'),
            ).not.toBeInTheDocument();
            await waitFor(() =>
                expect(
                    within(
                        screen.getByRole('list', { name: 'Chests' }),
                    ).getAllByRole('listitem'),
                ).toHaveLength(2),
            );
        });

        it('desktop: Enter on a row selects it; a new search clears the selection', async () => {
            media.desktop = true;
            const hits: string[] = [];
            server.use(
                valheimMaterialsHandler(materialsFixture()),
                drillHandler(hits),
            );
            renderTab();
            const table = await screen.findByRole('table', {
                name: 'Shared chest totals',
            });
            const wood = within(table).getByRole('button', { name: /Wood/ });
            wood.focus();
            await userEvent.keyboard('{Enter}');
            expect(wood).toHaveAttribute('aria-pressed', 'true');
            await waitFor(() =>
                expect(hits).toContain('?includeVehicles=true&prefab=Wood'),
            );
            await userEvent.type(
                screen.getByRole('searchbox', { name: 'Search materials' }),
                'wo',
            );
            await waitFor(() =>
                expect(
                    screen.queryByTestId('valheim-chests-holding'),
                ).not.toBeInTheDocument(),
            );
            expect(
                within(table).getByRole('button', { name: /Wood/ }),
            ).toHaveAttribute('aria-pressed', 'false');
        });
    });

    it('a failed chest list shows an error, not the empty copy (Codex r2)', async () => {
        server.use(
            valheimMaterialsHandler(materialsFixture()),
            http.get(VALHEIM_CONTAINERS_URL, () =>
                HttpResponse.json({ message: 'boom' }, { status: 500 }),
            ),
        );
        renderTab();
        await sharedList();
        const section = screen.getByRole('region', { name: 'Chests' });
        await waitFor(() =>
            expect(section).not.toHaveTextContent('Loading chests…'),
        );
        expect(section).not.toHaveTextContent('No chests to show.');
        expect(within(section).getByRole('alert')).toHaveTextContent(
            'Couldn’t load the chests. Try again in a moment.',
        );
    });

    it('an unreadable chest says so instead of "empty" (Codex r2)', async () => {
        server.use(
            valheimMaterialsHandler(materialsFixture()),
            valheimContainerHandler({
                ...chestSharedDetail,
                unreadable: true,
                usedSlots: 0,
                stacks: [],
            }),
        );
        renderTab();
        const chests = await screen.findByRole('list', { name: 'Chests' });
        await userEvent.click(
            within(chests).getByRole('button', { name: /Wood chest/ }),
        );
        const detail = await screen.findByTestId('valheim-chest-detail');
        await waitFor(() =>
            expect(detail).not.toHaveTextContent('Loading chest…'),
        );
        expect(detail).not.toHaveTextContent('This chest is empty.');
        expect(within(detail).getByRole('status')).toHaveTextContent(
            'Raid Ledger couldn’t read this chest’s contents',
        );
    });
});
