/**
 * ROK-1747: the equipment render slot shows the Forever fallback portrait when
 * the character has no Blizzard render. The render always wins; with neither,
 * the grid keeps its 2-column layout.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { EquipmentGrid } from './equipment-grid';
import { selectForeverPortrait, type ForeverPortrait } from '../lib/forever-portrait';
import type { EquipmentItemDto, CharacterEquipmentDto } from '@raid-ledger/contract';

const RACE_URL = 'https://wow.zamimg.com/images/wow/icons/large/race_nightelf_female.jpg';
const RENDER_URL = 'https://render.example/character-main-raw.png';

function mockMatchMedia(matches: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn((query: string) => ({
            matches, media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(() => false),
        })),
    });
}

function createEquipment(): CharacterEquipmentDto {
    const item: EquipmentItemDto = {
        slot: 'HEAD', name: 'Test Helm', itemId: 1, quality: 'EPIC', itemLevel: 200,
        itemSubclass: 'Plate', enchantments: [], sockets: [],
    };
    return { equippedItemLevel: null, items: [item], syncedAt: new Date().toISOString() };
}

const racePortrait = selectForeverPortrait({
    variant: 'wow_forever', avatarUrl: null, race: 'Night Elf', gender: 'female',
    characterClass: 'Druid', name: 'Ayla',
});

function renderGrid(renderUrl: string | null, portrait?: ForeverPortrait): void {
    mockMatchMedia(false);
    render(
        <EquipmentGrid equipment={createEquipment()} gameVariant={null} renderUrl={renderUrl}
            onItemClick={vi.fn()} {...(portrait ? { portrait } : {})} />,
    );
}

describe('EquipmentGrid — Forever portrait in the render slot (ROK-1747)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows the race portrait in the centre of both layouts when there is no render', () => {
        expect(racePortrait.kind).toBe('race');
        renderGrid(null, racePortrait);
        const centres = screen.queryAllByTestId('equipment-portrait');
        expect(centres).toHaveLength(2); // desktop 3-col + phone stacked
        for (const centre of centres) {
            const tile = within(centre).queryByTestId('forever-portrait');
            expect(tile, 'forever-portrait tile in the centre').not.toBeNull();
            expect(tile).toHaveAttribute('data-portrait', 'race');
            expect(tile?.querySelector(`img[src="${RACE_URL}"]`), 'race icon img in the centre tile').not.toBeNull();
        }
        expect(screen.queryByRole('img', { name: 'Character render' })).toBeNull();
    });

    it('keeps the Blizzard render and shows no portrait when renderUrl is set', () => {
        renderGrid(RENDER_URL, racePortrait);
        const renders = screen.queryAllByRole('img', { name: 'Character render' });
        expect(renders).toHaveLength(2);
        for (const img of renders) expect(img).toHaveAttribute('src', RENDER_URL);
        expect(screen.queryByTestId('equipment-portrait')).toBeNull();
        expect(screen.queryByTestId('forever-portrait')).toBeNull();
    });

    it('keeps the 2-column grid when there is no render and no portrait', () => {
        renderGrid(null);
        expect(screen.queryByTestId('equipment-portrait')).toBeNull();
        expect(screen.queryByRole('img', { name: 'Character render' })).toBeNull();
        expect(screen.getAllByRole('link', { name: 'Test Helm' })).toHaveLength(1);
    });

    it('keeps the 2-column grid when the portrait kind is none', () => {
        renderGrid(null, { kind: 'none' });
        expect(screen.queryByTestId('equipment-portrait')).toBeNull();
        expect(screen.getAllByRole('link', { name: 'Test Helm' })).toHaveLength(1);
    });
});
