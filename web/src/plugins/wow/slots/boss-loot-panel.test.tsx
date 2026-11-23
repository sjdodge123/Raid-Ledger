/**
 * ROK-1719 AC5: the Boss & Loot panel hides when every instance on the
 * event has no boss data (hand-seeded WoW: Forever instances).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { BossEncounterDto, BossLootDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { BossLootPanel } from './boss-loot-panel';

vi.mock('../../../hooks/use-character-detail', () => ({
    useCharacterDetail: () => ({ data: null, isLoading: false }),
}));

vi.mock('../hooks/use-wowhead-tooltips', () => ({
    useWowheadTooltips: () => {},
}));

const API = 'http://localhost:3000';
const SEEDED_A = { id: 90_000_001, name: 'Hyjal Summit' };
const SEEDED_B = { id: 90_000_002, name: 'Karazhan Crypts' };
const DEADMINES = { id: 63, name: 'The Deadmines' };

function boss(instanceId: number): BossEncounterDto {
    return { id: 1, instanceId, name: 'Edwin VanCleef', order: 1, expansion: 'classic', sodModified: false };
}

function serveBosses(byInstance: Record<number, BossEncounterDto[]>) {
    let calls = 0;
    server.use(http.get(`${API}/plugins/wow-classic/instances/:id/bosses`, ({ params }) => {
        calls += 1;
        return HttpResponse.json(byInstance[Number(params.id)] ?? []);
    }));
    return () => calls;
}

function renderPanel(contentInstances: Record<string, unknown>[], gameSlug = 'world-of-warcraft-forever') {
    return renderWithProviders(
        <BossLootPanel contentInstances={contentInstances} gameSlug={gameSlug} />,
    );
}

/** Serve an empty loot list for every boss; returns the variants requested. */
function serveEmptyLoot(status = 200) {
    const variants: (string | null)[] = [];
    server.use(http.get(`${API}/plugins/wow-classic/bosses/:id/loot`, ({ request }) => {
        variants.push(new URL(request.url).searchParams.get('variant'));
        return status === 200 ? HttpResponse.json([]) : HttpResponse.json({ message: 'boom' }, { status });
    }));
    return variants;
}

/** Expand the only boss and return its empty-loot element plus the loot variants requested. */
async function expandBossWithNoLoot(gameSlug: string, expectedText: string, status = 200) {
    serveBosses({ [DEADMINES.id]: [boss(DEADMINES.id)] });
    const variants = serveEmptyLoot(status);
    renderPanel([DEADMINES], gameSlug);
    await userEvent.setup().click(await screen.findByText('Edwin VanCleef'));
    const empty = await screen.findByText(expectedText);
    return { empty, variants };
}

describe('BossLootPanel — bossless instances (ROK-1719)', () => {
    it('renders nothing once every instance returns an empty boss list', async () => {
        const calls = serveBosses({});
        const { container } = renderPanel([SEEDED_A, SEEDED_B]);
        await waitFor(() => expect(calls()).toBe(2));
        await waitFor(() => expect(screen.queryByText('Loading bosses…')).toBeNull());
        expect(screen.queryByText('Boss & Loot'), 'Boss & Loot header must not render for bossless instances').toBeNull();
        expect(container.innerHTML).toBe('');
    });

    it('renders the panel when at least one instance has bosses', async () => {
        serveBosses({ [DEADMINES.id]: [boss(DEADMINES.id)] });
        renderPanel([SEEDED_A, DEADMINES]);
        expect(await screen.findByText('Edwin VanCleef')).toBeInTheDocument();
        expect(screen.getByText('Boss & Loot')).toBeInTheDocument();
    });

    it('names the boss-row Wowhead link for assistive tech (TDB 2552)', async () => {
        serveBosses({ [DEADMINES.id]: [boss(DEADMINES.id)] });
        renderPanel([DEADMINES]);
        await screen.findByText('Edwin VanCleef');
        expect(screen.getByRole('link', { name: 'View on Wowhead' })).toHaveAttribute('target', '_blank');
    });
});

describe('BossLootPanel — boss with no loot (ROK-2209)', () => {
    const FOREVER_COPY = "Forever loot for this boss isn't captured yet.";

    it('says Forever loot is not captured yet on a Forever event', async () => {
        const { empty, variants } = await expandBossWithNoLoot('world-of-warcraft-forever', FOREVER_COPY);
        expect(empty).toHaveTextContent(FOREVER_COPY);
        expect(screen.queryByText('No loot data available'), 'Forever must not show the generic empty copy').toBeNull();
        expect(variants).toEqual(['wow_forever']);
    });

    it('keeps "No loot data available" on a Classic event', async () => {
        const { empty, variants } = await expandBossWithNoLoot('world-of-warcraft-classic', 'No loot data available');
        expect(empty).toHaveTextContent('No loot data available');
        expect(screen.queryByText(FOREVER_COPY), 'Classic must not show the Forever copy').toBeNull();
        expect(variants).toEqual(['classic_era']);
    });

    it('a failed loot request says it could not load, not "not captured"', async () => {
        await expandBossWithNoLoot('world-of-warcraft-forever', "Couldn't load loot.", 500);
        expect(screen.queryByText(FOREVER_COPY), 'an error must not read as uncaptured loot').toBeNull();
    });
});

describe('BossLootPanel — Classic loot fallback on Forever (ROK-2270)', () => {
    const NOTICE = 'Classic loot, Forever drops not captured';
    const FOREVER_COPY = "Forever loot for this boss isn't captured yet.";

    function lootItem(expansion: BossLootDto['expansion']): BossLootDto {
        return {
            id: 11, bossId: 1, itemId: 6460, itemName: 'Cobrahn\'s Grasp', slot: 'Waist', quality: 'Rare',
            itemLevel: 23, dropRate: null, expansion, classRestrictions: null, iconUrl: null, itemSubclass: 'Leather',
            tooltip: null,
        };
    }

    async function expandBossWithLoot(gameSlug: string, expansion: BossLootDto['expansion']) {
        serveBosses({ [DEADMINES.id]: [boss(DEADMINES.id)] });
        server.use(http.get(`${API}/plugins/wow-classic/bosses/:id/loot`, () => HttpResponse.json([lootItem(expansion)])));
        renderPanel([DEADMINES], gameSlug);
        await userEvent.setup().click(await screen.findByText('Edwin VanCleef'));
        await screen.findByText("Cobrahn's Grasp");
    }

    it('labels Classic rows on a Forever event as Classic loot', async () => {
        await expandBossWithLoot('world-of-warcraft-forever', 'classic');
        expect(screen.getByRole('note')).toHaveTextContent(NOTICE);
        expect(screen.queryByText(FOREVER_COPY), 'a fallback list is not "not captured"').toBeNull();
    });

    it('shows no label when the Forever rows are real Forever loot', async () => {
        await expandBossWithLoot('world-of-warcraft-forever', 'forever');
        expect(screen.queryByText(NOTICE), 'real Forever rows must not be labelled Classic').toBeNull();
    });

    it('shows no label for Classic rows on a Classic event', async () => {
        await expandBossWithLoot('world-of-warcraft-classic', 'classic');
        expect(screen.queryByText(NOTICE), 'a Classic event reads its own rows').toBeNull();
    });
});
