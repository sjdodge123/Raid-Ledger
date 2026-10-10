/**
 * ROK-1726 (AC5, D6): the sections slot resolves the effective WoW variant
 * once — including a manual WoW: Forever character (`gameVariant: null` + a
 * ruleset, read from the page's cached character query) — and drives the
 * empty states and Wowhead links from it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

interface Case { gameVariant: string | null; ruleset?: string | null; isArmoryImported?: boolean; equipment?: CharacterEquipmentDto | null }

function renderSections({ gameVariant, ruleset = null, isArmoryImported = false, equipment = null }: Case) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['characters', 'char-1'], { id: 'char-1', gameVariant, ruleset });
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
