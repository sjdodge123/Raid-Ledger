/** ROK-1853 — the hub Materials tab: totals, search, vehicles toggle, personal, empty, warnings, drill-down. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    VALHEIM_MATERIALS_URL,
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
        expect(
            within(list).getByText('q1 ×1 · q2 ×3 · 1 chest'),
        ).toBeInTheDocument();
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
});
