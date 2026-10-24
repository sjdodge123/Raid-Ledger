/** ROK-1859 — the Materials Base filter: options, per-base totals, chest names, personal by base, the hash, absent fields. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    BASE_C,
    basesFixture,
    containersWithBases,
    materialsFixture,
    personalWithBases,
    valheimContainerHandler,
    valheimContainersHandler,
    valheimMaterialsHandler,
} from '../../../test/mocks/valheim-materials-handlers';
import { ValheimMaterialsTab } from './valheim-materials-tab';

vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: () => false,
}));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const withBases = () =>
    materialsFixture({ bases: basesFixture, personal: personalWithBases });
const renderTab = () =>
    renderWithProviders(<ValheimMaterialsTab serverId={7} />);
const sharedNames = async () =>
    within(await screen.findByRole('list', { name: 'Shared chest totals' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
const chestNames = async () =>
    within(await screen.findByRole('list', { name: 'Chests' }))
        .getAllByRole('button', { name: /chest|Cart/ })
        .map((b) => b.textContent);
const openFilters = () =>
    userEvent.click(screen.getByRole('button', { name: /^Filters/ }));

beforeEach(() => {
    window.history.replaceState(null, '', '/hub#materials');
    server.use(
        valheimContainersHandler(containersWithBases()),
        valheimContainerHandler(),
    );
});

describe('ValheimMaterialsTab — Base filter (ROK-1859)', () => {
    it('lists All bases first, then each base with its chest count', async () => {
        server.use(valheimMaterialsHandler(withBases()));
        renderTab();
        await sharedNames();
        await openFilters();
        const select = screen.getByRole('combobox', { name: 'Base' });
        expect(
            within(select)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual([
            'All bases',
            'Base near x 3, z 53 · 5 chests',
            'Base near x 610, z −420 · 1 chest',
        ]);
    });

    it('names every chest by prefab, index and base', async () => {
        server.use(valheimMaterialsHandler(withBases()));
        renderTab();
        expect(await chestNames()).toEqual([
            expect.stringContaining('Wood chest 2 · Base near x 3, z 53'),
            expect.stringContaining('Cart 1 · Away from bases'),
            expect.stringContaining('Wood chest 1 · Base near x 610, z −420'),
        ]);
    });

    it('choosing a base swaps in its totals, narrows the chests and writes base= to the hash', async () => {
        server.use(valheimMaterialsHandler(withBases()));
        renderTab();
        await sharedNames();
        await openFilters();
        await userEvent.selectOptions(
            screen.getByRole('combobox', { name: 'Base' }),
            BASE_C,
        );
        expect(window.location.hash).toBe(`#materials?base=${BASE_C}`);
        await waitFor(async () =>
            expect(await sharedNames()).toEqual([
                expect.stringContaining('Stone'),
            ]),
        );
        expect(await chestNames()).toEqual([
            expect.stringContaining('Wood chest 1 · Base near x 610, z −420'),
        ]);
    });

    it('the personal section follows the base via personal.byBase', async () => {
        window.history.replaceState(null, '', `/hub#materials?base=${'A'.repeat(22)}`);
        server.use(valheimMaterialsHandler(withBases()));
        renderTab();
        const mine = await screen.findByRole('list', {
            name: 'Personal chest totals',
        });
        expect(
            within(mine)
                .getAllByRole('listitem')
                .map((li) => li.textContent),
        ).toEqual([expect.stringContaining('Coins')]);
        expect(screen.getByText(/^1 chest$/)).toBeInTheDocument();
    });

    it('Clear all resets the base and keeps the open item', async () => {
        window.history.replaceState(
            null,
            '',
            `/hub#materials?item=Stone&base=${BASE_C}`,
        );
        server.use(valheimMaterialsHandler(withBases()));
        renderTab();
        await sharedNames();
        await openFilters();
        await userEvent.click(screen.getByRole('button', { name: /Clear all/ }));
        expect(window.location.hash).toBe('#materials?item=Stone');
    });

    it('a stale base key falls back to All bases', async () => {
        window.history.replaceState(null, '', `/hub#materials?base=${'Z'.repeat(22)}`);
        server.use(valheimMaterialsHandler(withBases()));
        renderTab();
        expect(await sharedNames()).toHaveLength(3);
        expect(await chestNames()).toHaveLength(3);
    });

    it('without bases/base/index (older API) there is no Base select and chests keep the bare label', async () => {
        server.use(
            valheimMaterialsHandler(materialsFixture()),
            valheimContainersHandler(),
        );
        renderTab();
        expect(await chestNames()).toEqual([
            expect.stringMatching(/^Wood chest/),
            expect.stringMatching(/^Cart/),
        ]);
        expect(
            screen.getAllByTestId('valheim-chest-map-link')[0],
        ).toHaveAttribute(
            'aria-label',
            'Show Wood chest at x 120, z −340 on the map',
        );
        await openFilters();
        expect(
            screen.queryByRole('combobox', { name: 'Base' }),
        ).not.toBeInTheDocument();
    });
});
