/**
 * ROK-1726 (AC5, D6): the sections slot resolves the effective WoW variant
 * once — including a manual WoW: Forever character (`gameVariant: null` + a
 * ruleset, read from the page's cached character query) — and drives the
 * empty states and Wowhead links from it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CharacterEquipmentDto } from '@raid-ledger/contract';
import { CharacterDetailSections } from './character-detail-sections';
import { FOREVER_ADDON_HINT_EQUIPMENT, FOREVER_ADDON_HINT_TALENTS } from '../lib/wow-variant-config';

vi.mock('../hooks/use-wowhead-tooltips', () => ({ useWowheadTooltips: vi.fn() }));
vi.mock('../components/CharacterProfessionsPanel', () => ({ CharacterProfessionsPanel: () => null }));

const ARMORY_EQUIPMENT = 'Equipment data is only available for characters imported from the Blizzard Armory.';
const ARMORY_TALENTS = 'Talent data is only available for characters imported from the Blizzard Armory.';
const REFRESH_EQUIPMENT = 'Equipment data may not be available for this character. Try refreshing.';
const EQUIPMENT: CharacterEquipmentDto = {
    equippedItemLevel: 60,
    syncedAt: '2026-10-01T00:00:00.000Z',
    items: [{ slot: 'HEAD', name: 'Test Helm', itemId: 19019, quality: 'EPIC', itemLevel: 60, itemSubclass: 'Plate' }],
};

interface Case {
    gameVariant: string | null; ruleset?: string | null; isArmoryImported?: boolean;
    equipment?: CharacterEquipmentDto | null; gameSlug?: string; registryPending?: boolean;
}

/** Seeds the character + game registry caches; `registryPending` leaves the registry to load over the network. */
function renderSections({ gameVariant, ruleset = null, isArmoryImported = false, equipment = null, gameSlug, registryPending }: Case) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['characters', 'char-1'], { id: 'char-1', gameId: 1, gameVariant, ruleset });
    if (!registryPending) client.setQueryData(['game-registry'], { data: gameSlug ? [{ id: 1, slug: gameSlug, name: 'WoW' }] : [] });
    const { container } = render(
        <QueryClientProvider client={client}>
            <CharacterDetailSections equipment={equipment} talents={null} professions={null} gameVariant={gameVariant}
                renderUrl={null} isArmoryImported={isArmoryImported} characterClass="Mage" isOwner={false}
                characterId="char-1" gameId={1} />
        </QueryClientProvider>,
    );
    return container;
}

const hintUnder = (title: string) => screen.getByText(title).nextElementSibling?.textContent;

describe('CharacterDetailSections — empty-state copy (AC5)', () => {
    it.each<[string, Case]>([
        ['gameVariant wow_forever', { gameVariant: 'wow_forever' }],
        ['manual Forever: gameVariant null + ruleset', { gameVariant: null, ruleset: 'pvp' }],
    ])('%s → addon hints, not the Armory copy', (_label, c) => {
        renderSections(c);
        expect(hintUnder('No equipment data')).toBe(FOREVER_ADDON_HINT_EQUIPMENT);
        expect(hintUnder('No talent data')).toBe(FOREVER_ADDON_HINT_TALENTS);
    });

    it.each(['classic_era', 'retail', null])('%j without a ruleset keeps the Armory copy verbatim', (gameVariant) => {
        renderSections({ gameVariant });
        expect(hintUnder('No equipment data')).toBe(ARMORY_EQUIPMENT);
        expect(hintUnder('No talent data')).toBe(ARMORY_TALENTS);
    });

    it('an Armory-imported character with an empty item list keeps the refresh copy', () => {
        renderSections({ gameVariant: 'classic_era', isArmoryImported: true, equipment: { ...EQUIPMENT, items: [] } });
        expect(hintUnder('No equipment data')).toBe(REFRESH_EQUIPMENT);
    });
});

describe('CharacterDetailSections — Wowhead item links use the resolved variant (D6)', () => {
    it.each<[string, Case, string]>([
        ['manual Forever (null variant + ruleset)', { gameVariant: null, ruleset: 'pvp' }, 'https://www.wowhead.com/forever/item=19019'],
        ['Classic Era', { gameVariant: 'classic_era' }, 'https://www.wowhead.com/classic/item=19019'],
        ['retail', { gameVariant: 'retail' }, 'https://www.wowhead.com/item=19019'],
    ])('%s', (_label, c, href) => {
        const container = renderSections({ ...c, isArmoryImported: true, equipment: EQUIPMENT });
        expect(container.querySelector('a[href*="wowhead.com"]')?.getAttribute('href')).toBe(href);
    });
});

/** ROK-1727 (Q4): addon equipment shows its source + snapshot date; Armory shows nothing new. */
describe('CharacterDetailSections — via-addon source line', () => {
    it('source addon → "via addon · <date>" in muted text under the heading', () => {
        renderSections({ gameVariant: 'wow_forever', equipment: { ...EQUIPMENT, source: 'addon', syncedAt: '2026-10-01T12:00:00.000Z' } });
        const line = screen.getByText('via addon · 1 Oct 2026');
        expect(line).toHaveClass('text-xs', 'text-muted');
    });

    it.each<[string, CharacterEquipmentDto]>([
        ['source armory', { ...EQUIPMENT, source: 'armory' }],
        ['source absent', EQUIPMENT],
    ])('%s → no via-addon line', (_label, equipment) => {
        renderSections({ gameVariant: 'classic_era', isArmoryImported: true, equipment });
        expect(screen.queryByText(/via addon/)).toBeNull();
    });
});

/** ROK-1751: LedgerLink exports carry `ruleset: null`; the character's game slug resolves Forever. */
describe('CharacterDetailSections — Forever resolved from the game slug', () => {
    const QUESTS = {
        source: 'addon', syncedAt: '2026-10-01T12:00:00.000Z', inProgress: [], completedKnown: [],
        counts: { completedKnown: 0, knownTotal: 3, completedTotal: 5, inProgress: 0 },
    };

    it('Forever game + null variant + null ruleset → addon hints and the Quests section', async () => {
        let questsRequested = false;
        server.use(http.get('http://localhost:3000/plugins/wow/characters/char-1/quests', () => {
            questsRequested = true;
            return HttpResponse.json({ quests: QUESTS });
        }));
        renderSections({ gameVariant: null, ruleset: null, gameSlug: 'world-of-warcraft-forever' });
        expect(hintUnder('No equipment data')).toBe(FOREVER_ADDON_HINT_EQUIPMENT);
        expect(await screen.findByRole('heading', { name: 'Quests' })).toBeInTheDocument();
        expect(questsRequested).toBe(true);
    });

    it('Classic game + null ruleset → Armory copy, no Quests section', () => {
        renderSections({ gameVariant: null, ruleset: null, gameSlug: 'world-of-warcraft-classic' });
        expect(hintUnder('No equipment data')).toBe(ARMORY_EQUIPMENT);
        expect(screen.queryByRole('heading', { name: 'Quests' })).toBeNull();
    });
});

/** ROK-1751 review MINOR 1: no Armory copy -> addon hint flip while the registry is still loading. */
describe('CharacterDetailSections — game registry still loading', () => {
    it('null variant + null ruleset while the registry is pending → neither the Armory copy nor the addon hint', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let questsRequested = false;
        server.use(
            http.get('http://localhost:3000/games/configured', async () => {
                await gate;
                return HttpResponse.json({ data: [{ id: 1, slug: 'world-of-warcraft-forever', name: 'WoW' }] });
            }),
            http.get('http://localhost:3000/plugins/wow/characters/char-1/quests', () => {
                questsRequested = true;
                return HttpResponse.json({ quests: null });
            }),
        );
        renderSections({ gameVariant: null, ruleset: null, registryPending: true });
        expect(screen.queryByText(ARMORY_EQUIPMENT)).toBeNull();
        expect(screen.queryByText(ARMORY_TALENTS)).toBeNull();
        expect(screen.queryByText(FOREVER_ADDON_HINT_EQUIPMENT)).toBeNull();
        expect(questsRequested).toBe(false);
        release();
        expect(await screen.findByText(FOREVER_ADDON_HINT_EQUIPMENT)).toBeInTheDocument();
        expect(screen.queryByText(ARMORY_EQUIPMENT)).toBeNull();
        await waitFor(() => expect(questsRequested).toBe(true));
    });
});
