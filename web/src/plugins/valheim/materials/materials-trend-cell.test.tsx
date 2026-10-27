/** ROK-2014 — Materials item-row trend chip in the tab: copy, tone, dots, detail toggle, Base filter, no-history rows (AC1–3, AC7). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ValheimMaterialsResponse } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    BASE_A,
    basesFixture,
    containersWithBases,
    materialsFixture,
    valheimContainerHandler,
    valheimContainersHandler,
    valheimMaterialsHandler,
} from '../../../test/mocks/valheim-materials-handlers';
import { ValheimMaterialsTab } from './valheim-materials-tab';

const mq = vi.hoisted(() => ({ desktop: false }));
vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: () => mq.desktop,
}));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const SHARED_TREND = {
    days: [
        { date: '2026-10-17', gains: { Wood: 20, Stone: -10 } },
        { date: '2026-10-16', gains: { Wood: 15 } },
        { date: '2026-10-14', gains: { Wood: 10 } },
    ],
};
const BASE_A_TREND = {
    days: [
        { date: '2026-10-17', gains: { Wood: 5 } },
        { date: '2026-10-16', gains: {} },
        { date: '2026-10-14', gains: {} },
    ],
};

/** `null` = no `trend` key at all (the API's "fewer than two play days"). */
function withTrend(
    trend: ValheimMaterialsResponse['shared']['trend'] | null = SHARED_TREND,
): ValheimMaterialsResponse {
    const base = materialsFixture();
    const [a, ...rest] = basesFixture;
    return materialsFixture({
        shared: { ...base.shared, ...(trend !== null && trend !== undefined && { trend }) },
        bases: a === undefined ? rest : [{ ...a, trend: BASE_A_TREND }, ...rest],
    });
}

const sharedList = () => screen.findByRole('list', { name: 'Shared chest totals' });
const rowOf = async (label: string): Promise<HTMLElement> => {
    const li = within(await sharedList())
        .getAllByRole('listitem')
        .find((el) => el.textContent?.includes(label));
    if (li === undefined) throw new Error(`no row ${label}`);
    return li;
};

beforeEach(() => {
    mq.desktop = false;
    window.history.replaceState(null, '', '/hub#materials');
    server.use(valheimContainersHandler(containersWithBases()), valheimContainerHandler());
});

describe('Materials trend chip (ROK-2014)', () => {
    it('a gaining row reads "+45 over 3 days", success tint, dots oldest → newest', async () => {
        server.use(valheimMaterialsHandler(withTrend()));
        renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        const chip = within(await rowOf('Wood')).getByRole('button', { name: /^\+45 over 3 days/ });
        expect(chip).toHaveAttribute('data-tone', 'success');
        expect(chip).toHaveAccessibleName(
            '+45 over 3 days: +20 on Oct 17, +15 on Oct 16, +10 on Oct 14',
        );
        const dots = Array.from(within(chip).getByTestId('materials-trend-dots').children);
        expect(dots.map((d) => d.getAttribute('data-filled'))).toEqual(['true', 'true', 'true']);
    });

    it('a net drop uses the danger tint; a row with no change has no chip', async () => {
        server.use(valheimMaterialsHandler(withTrend()));
        renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        const stone = within(await rowOf('Stone')).getByRole('button', { name: /^−10 over 3 days/ });
        expect(stone).toHaveAttribute('data-tone', 'danger');
        expect(within(await rowOf('Iron sword')).queryByTestId('materials-trend')).toBeNull();
    });

    it('tap toggles the per-day line; hover shows it via title', async () => {
        server.use(valheimMaterialsHandler(withTrend()));
        renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        const row = await rowOf('Wood');
        const chip = within(row).getByRole('button', { name: /^\+45 over 3 days/ });
        const detailText = 'Oct 17 +20 · Oct 16 +15 · Oct 14 +10';
        expect(chip).toHaveAttribute('title', detailText);
        const detail = within(row).getByText(detailText, { selector: 'p' });
        expect(detail).not.toBeVisible();
        await userEvent.click(chip);
        expect(chip).toHaveAttribute('aria-expanded', 'true');
        expect(detail).toBeVisible();
        expect(chip).toHaveAttribute('aria-controls', detail.id);
    });

    it('under the Base filter the item rows show that base’s trend (AC2)', async () => {
        server.use(valheimMaterialsHandler(withTrend()));
        window.history.replaceState(null, '', `/hub#materials?base=${BASE_A}`);
        renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        const row = await rowOf('Wood');
        expect(within(row).getByRole('button', { name: /^\+5 over 3 days/ })).toBeInTheDocument();
        expect(within(row).queryByRole('button', { name: /^\+45/ })).toBeNull();
    });

    it('no trend, days: [] and an all-zero history render the same rows as before trends (AC3)', async () => {
        server.use(valheimMaterialsHandler(withTrend(null)));
        const plain = renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        const before = (await sharedList()).outerHTML;
        expect(within(await sharedList()).queryByTestId('materials-trend')).toBeNull();
        plain.unmount();
        for (const trend of [{ days: [] }, { days: [{ date: '2026-10-17', gains: {} }] }]) {
            server.use(valheimMaterialsHandler(withTrend(trend)));
            const view = renderWithProviders(<ValheimMaterialsTab serverId={7} />);
            expect((await sharedList()).outerHTML).toBe(before);
            view.unmount();
        }
    });

    it('desktop: a Trend column between Item and Total only when a row has a chip', async () => {
        mq.desktop = true;
        server.use(valheimMaterialsHandler(withTrend()));
        const view = renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        const table = await screen.findByRole('table', { name: 'Shared chest totals' });
        expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
            'Item',
            'Trend',
            'Total▼',
            'Chests',
        ]);
        expect(within(table).getByRole('button', { name: /^\+45 over 3 days/ })).toBeInTheDocument();
        view.unmount();
        server.use(valheimMaterialsHandler(withTrend(null)));
        renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        const bare = await screen.findByRole('table', { name: 'Shared chest totals' });
        expect(within(bare).queryByRole('columnheader', { name: 'Trend' })).toBeNull();
    });
});
