/** ROK-1948 — the Planner under spoiler protection: status line, protected-empty state, hidden stored targets, withheld plan nodes. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { materialsFixture, valheimMaterialsHandler } from '../../../test/mocks/valheim-materials-handlers';
import {
    VALHEIM_RECIPE_PLAN_URL,
    parseTargetsParam,
    recipeCatalogFixture,
    recipeCatalogProtectedFixture,
    recipePlanUndiscoveredFixture,
    valheimRecipeCatalogHandler,
    valheimRecipePlanHandler,
    valheimRecipeStockHandler,
} from '../../../test/mocks/valheim-recipes-handlers';
import { PLANNER_NO_SET_COPY } from './planner.helpers';
import { plannerStorageKey } from './planner-storage';
import {
    HIDDEN_TARGET_COPY,
    PLAN_UNDISCOVERED_COPY,
    SPOILERS_EMPTY_COPY,
    SPOILERS_OFF_NO_DATA_COPY,
    SPOILERS_OFF_TRUNCATED_COPY,
    SPOILERS_PROTECTED_COPY,
    UNDISCOVERED_NODE_COPY,
} from './spoilers.helpers';
import { ValheimPlannerTab } from './valheim-planner-tab';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const KEY = plannerStorageKey(7);
const target = (prefab: string) => ({ prefab, kind: 'item', quality: 1, fromQuality: 0, amount: 1 });
let planHits: string[];

const renderTab = () => renderWithProviders(<ValheimPlannerTab serverId={7} />);
const plannedList = () => screen.findByRole('list', { name: 'Planned items' });

beforeEach(() => {
    localStorage.clear();
    planHits = [];
    server.use(
        valheimRecipeStockHandler(),
        valheimRecipeCatalogHandler(recipeCatalogProtectedFixture()),
        valheimRecipePlanHandler(planHits),
        valheimMaterialsHandler(materialsFixture()),
    );
});
afterEach(() => vi.restoreAllMocks());

describe('status line', () => {
    it('protected → the muted "Showing only what someone…" line under the search row', async () => {
        renderTab();
        const line = await screen.findByTestId('valheim-planner-spoilers');
        expect(line.textContent, 'protected line').toBe(SPOILERS_PROTECTED_COPY);
        expect(line.className).toContain('text-muted');
    });
    it.each([
        ['off-no-data', SPOILERS_OFF_NO_DATA_COPY],
        ['off-truncated', SPOILERS_OFF_TRUNCATED_COPY],
    ] as const)('%s → the full catalogue with its own muted "protection is off" note', async (spoilers, copy) => {
        server.use(valheimRecipeCatalogHandler(recipeCatalogFixture({ spoilers })));
        renderTab();
        const line = await screen.findByTestId('valheim-planner-spoilers');
        expect(line.textContent, `${spoilers} note`).toBe(copy);
        expect(line.className).toContain('text-muted');
        expect(screen.queryByText(SPOILERS_PROTECTED_COPY), 'no protected line when off').toBeNull();
    });
    it('no status from the server (older API) → no spoiler line at all', async () => {
        server.use(valheimRecipeCatalogHandler(recipeCatalogFixture({})));
        renderTab();
        await screen.findByRole('searchbox', { name: 'Search an item or piece' });
        expect(screen.queryByTestId('valheim-planner-spoilers')).toBeNull();
    });
});

describe('protected with nothing visible', () => {
    it('shows the protected empty state, not the no-recipes copy', async () => {
        server.use(valheimRecipeCatalogHandler(recipeCatalogProtectedFixture({ entries: [], stations: [], ingredients: {} })));
        renderTab();
        await waitFor(() => expect(screen.queryByText('Loading recipes…')).toBeNull());
        expect(screen.queryByText(PLANNER_NO_SET_COPY)).toBeNull();
        expect(screen.queryByText(SPOILERS_EMPTY_COPY)).not.toBeNull();
    });
});

describe('a stored target that is now hidden', () => {
    beforeEach(() => localStorage.setItem(KEY, JSON.stringify([target('SwordIron'), target('Club')])));

    it('renders the generic row without its name, and the plan request leaves it out', async () => {
        renderTab();
        const list = await plannedList();
        expect(within(list).getByTestId('valheim-planner-hidden-target')).toHaveTextContent(HIDDEN_TARGET_COPY);
        expect(list).not.toHaveTextContent(/Iron sword|SwordIron/);
        await waitFor(() => expect(planHits.length).toBeGreaterThan(0));
        for (const hit of planHits) {
            expect(parseTargetsParam(new URLSearchParams(hit).get('targets') ?? '').map((t) => t.prefab)).toEqual(['Club']);
        }
    });

    it('stays in storage until removed; Remove drops only it', async () => {
        const user = userEvent.setup();
        renderTab();
        await plannedList();
        expect(localStorage.getItem(KEY)).toContain('SwordIron');
        await user.click(screen.getByRole('button', { name: 'Remove hidden item' }));
        await waitFor(() => expect(screen.queryByTestId('valheim-planner-hidden-target')).toBeNull());
        expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual([target('Club')]);
    });

    it('with only hidden targets, no plan request is sent', async () => {
        localStorage.setItem(KEY, JSON.stringify([target('SwordIron')]));
        renderTab();
        await plannedList();
        expect(planHits).toEqual([]);
    });
});

describe('a plan node the server withheld', () => {
    beforeEach(() => {
        localStorage.setItem(KEY, JSON.stringify([target('Club')]));
        server.use(
            http.get(VALHEIM_RECIPE_PLAN_URL, ({ request }) =>
                HttpResponse.json(recipePlanUndiscoveredFixture(parseTargetsParam(new URL(request.url).searchParams.get('targets') ?? ''))),
            ),
        );
    });

    it('names the withheld ingredient ("Bronze") with the not-yet-discovered note, and nothing under it', async () => {
        renderTab();
        await screen.findAllByTestId('valheim-planner-row');
        const row = screen.getByTestId('valheim-planner-row-undiscovered');
        expect(within(row).getByTestId('valheim-planner-row-name')).toHaveTextContent('Bronze');
        expect(within(row).getByTestId('valheim-planner-row-undiscovered-note')).toHaveTextContent(UNDISCOVERED_NODE_COPY);
        expect(row).toHaveAttribute('data-prefab', 'Bronze');
        // No disclosure (no children), no have/need bar, no station / "+N ways" chips.
        expect(within(row).queryByRole('button')).toBeNull();
        expect(within(row).queryByRole('meter')).toBeNull();
        expect(row).not.toHaveTextContent(/Forge|other way|Gathered/);
    });

    it('the withheld ingredient is not broken down in the shopping list', async () => {
        renderTab();
        await screen.findAllByTestId('valheim-planner-row');
        const list = screen.getByTestId('valheim-planner-undiscovered-footer').parentElement;
        expect(list).not.toHaveTextContent(/Copper|Tin/);
    });

    it('the shopping list carries the one-line footer', async () => {
        renderTab();
        await screen.findAllByTestId('valheim-planner-row');
        expect(screen.queryByTestId('valheim-planner-undiscovered-footer')?.textContent).toBe(PLAN_UNDISCOVERED_COPY);
    });

    it('no footer when every node is visible', async () => {
        server.use(valheimRecipePlanHandler(planHits));
        renderTab();
        await screen.findAllByTestId('valheim-planner-row');
        expect(screen.queryByText(PLAN_UNDISCOVERED_COPY)).toBeNull();
    });
});
