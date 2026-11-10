/**
 * ROK-1747: the equipment render slot shows the Forever fallback portrait when
 * the character has no Blizzard render. The render always wins; with neither,
 * the grid keeps its 2-column layout.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

function must<T>(value: T | undefined, label: string): T {
    if (value === undefined) throw new Error(`missing: ${label}`);
    return value;
}

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

/** ROK-2146 review MAJOR-2: the 3-col render layout keys on the panel width, not the viewport alone. */
describe('EquipmentGrid — container-query layout (ROK-2146)', () => {
    it('switches to 3 columns only at lg AND a 48rem panel (@3xl)', () => {
        renderGrid(RENDER_URL);
        expect(screen.getByTestId('equipment-layout').className.split(' '), 'the panel is the container').toContain('@container');
        const wide = screen.getByTestId('equipment-layout-wide').className.split(' ');
        expect(wide, '3-col needs lg + @3xl').toEqual(expect.arrayContaining(['hidden', 'lg:@3xl:grid', 'lg:@3xl:grid-cols-[1fr_minmax(14rem,18rem)_1fr]']));
        expect(wide.filter((c) => /^lg:grid/.test(c)), 'no viewport-only switch').toEqual([]);
        expect(screen.getByTestId('equipment-layout-narrow').className.split(' ')).toContain('lg:@3xl:hidden');
    });
});


/** ROK-2157: the desktop render filled a ~100px `auto` track; it now fills a fixed track and the column height. */
describe('EquipmentGrid — render sizing (ROK-2157)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('gives the render a fixed centre track and a centre cell stretched to the slot columns', () => {
        renderGrid(RENDER_URL);
        const wide = screen.getByTestId('equipment-layout-wide').className.split(' ');
        expect(wide, 'fixed centre track, not auto').toContain('lg:@3xl:grid-cols-[1fr_minmax(14rem,18rem)_1fr]');
        expect(wide, 'no auto centre track for the render').not.toContain('lg:@3xl:grid-cols-[1fr_auto_1fr]');
        const centre = screen.getByTestId('equipment-centre').className.split(' ');
        expect(centre, 'centre cell stretches and clips').toEqual(expect.arrayContaining(['self-stretch', 'overflow-hidden']));
        const frame = screen.getByTestId('equipment-render-frame').className.split(' ');
        expect(frame, 'frame fills the cell with a minimum height').toEqual(expect.arrayContaining(['relative', 'min-h-[24rem]']));
    });

    it('crops the render with object-cover at the 50%/35% focus on both layouts', () => {
        renderGrid(RENDER_URL);
        const [desktop, phone] = screen.getAllByRole('img', { name: 'Character render' });
        expect(desktop?.className.split(' '), 'desktop fills the frame').toEqual(
            expect.arrayContaining(['absolute', 'inset-0', 'h-full', 'w-full', 'object-cover', 'object-[50%_35%]']));
        expect(desktop?.className.split(' '), 'no contain/auto sizing').not.toContain('object-contain');
        expect(phone?.className.split(' '), 'phone is a 300px cover crop, capped at 400px wide').toEqual(
            expect.arrayContaining(['h-[300px]', 'w-full', 'max-w-[400px]', 'mx-auto', 'object-cover', 'object-[50%_35%]']));
    });

    it('keeps the portrait tile in an auto track with its unstretched cell when there is no render', () => {
        renderGrid(null, racePortrait);
        expect(screen.getAllByTestId('forever-portrait')).toHaveLength(2);
        expect(screen.queryByTestId('equipment-render-frame')).toBeNull();
        expect(screen.getByTestId('equipment-layout-wide').className.split(' ')).toContain('lg:@3xl:grid-cols-[1fr_auto_1fr]');
        const centre = screen.getByTestId('equipment-centre').className.split(' ');
        expect(centre).toEqual(expect.arrayContaining(['flex', 'items-center', 'justify-center', 'px-2']));
        expect(centre).not.toContain('self-stretch');
    });

    it('drops a render that fails to load to the portrait layout, leaving no blank fixed centre column', () => {
        renderGrid(RENDER_URL, racePortrait);
        fireEvent.error(must(screen.getAllByRole('img', { name: 'Character render' })[0], 'desktop render img'));
        expect(screen.queryByTestId('equipment-render-frame'), 'no render frame after the error').toBeNull();
        expect(screen.queryAllByRole('img', { name: 'Character render' }), 'no render imgs after the error').toHaveLength(0);
        expect(screen.getAllByTestId('forever-portrait'), 'portrait tile in both layouts').toHaveLength(2);
        expect(screen.getByTestId('equipment-layout-wide').className.split(' ')).toContain('lg:@3xl:grid-cols-[1fr_auto_1fr]');
    });

    it('drops a render that fails to load to the 2-column grid when there is no portrait', () => {
        renderGrid(RENDER_URL);
        fireEvent.error(must(screen.getAllByRole('img', { name: 'Character render' })[1], 'phone render img'));
        expect(screen.queryByTestId('equipment-layout'), 'no centre-column layout after the error').toBeNull();
        expect(screen.queryByTestId('equipment-render-frame')).toBeNull();
        expect(screen.getAllByRole('link', { name: 'Test Helm' }), '2-col grid renders the slot once').toHaveLength(1);
    });
});
