/** ROK-1836 L3 — the four real section bodies, rendered through the slot list. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    valheimBlobHandler,
    valheimSheetFixture,
} from '../../../test/mocks/valheim-armory-handlers';
import { ValheimCharacterSections } from './character-sections';

vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: () => false,
}));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const realUrl = {
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
};
afterEach(() => Object.assign(URL, realUrl));

beforeEach(() => {
    Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:x'),
        revokeObjectURL: vi.fn(),
    });
    server.use(valheimBlobHandler());
});

const section = (name: string) => screen.getByRole('region', { name });

describe('Valheim character sections', () => {
    it('no section is a placeholder any more', () => {
        renderWithProviders(
            <ValheimCharacterSections character={valheimSheetFixture()} />,
        );
        expect(screen.queryByText('Coming soon.')).toBeNull();
    });

    it('Equipment: nine labelled slots, filled ones are item buttons, the rest dashed + "(empty)"', () => {
        renderWithProviders(
            <ValheimCharacterSections character={valheimSheetFixture()} />,
        );
        const eq = section('Equipment');
        expect(eq.querySelectorAll('li[data-slot]')).toHaveLength(9);
        expect(
            within(eq).getByRole('button', {
                name: 'Iron sword, quality 3, equipped',
            }),
        ).toBeInTheDocument();
        expect(within(eq).getByText('Legs (empty)')).toBeInTheDocument();
        expect(screen.queryByTestId('valheim-missing-catalogue')).toBeNull();
    });

    it('Skills: sorted by level desc, vanilla names, modded id named, integer level + progress meter', () => {
        renderWithProviders(
            <ValheimCharacterSections character={valheimSheetFixture()} />,
        );
        const rows = Array.from(
            section('Skills').querySelectorAll('li[data-skill]'),
        );
        expect(rows.map((r) => r.getAttribute('data-skill'))).toEqual([
            'Run',
            'Swords',
            '-1287461328',
        ]);
        expect(
            within(section('Skills')).getByText('Modded skill -1287461328'),
        ).toBeInTheDocument();
        const swords = within(section('Skills')).getByRole('meter', {
            name: 'Swords progress to level 35',
        });
        expect(swords).toHaveAttribute('aria-valuenow', '25');
    });
});

describe('Valheim character sections (cont.)', () => {
    it('Inventory: width × height cells (AC2 — an unknown prefab keeps the geometry), EAQS bands, usage', () => {
        renderWithProviders(
            <ValheimCharacterSections character={valheimSheetFixture()} />,
        );
        const inv = section('Inventory');
        expect(within(inv).getAllByRole('gridcell')).toHaveLength(56);
        expect(within(inv).getAllByRole('row')).toHaveLength(7);
        expect(
            within(inv)
                .getAllByTestId('valheim-row-band')
                .map((b) => b.textContent),
        ).toEqual(['Equipment', 'Quick slots']);
        expect(
            within(inv).getByRole('button', { name: 'ModdedAxe' }),
        ).toHaveAttribute('data-kind', 'unknown');
        expect(within(inv).getByText('3 of 56 slots used')).toBeInTheDocument();
        expect(
            within(inv).getByLabelText('Inventory grid, scrolls sideways'),
        ).toHaveAttribute('tabindex', '0');
    });

    it('Trophies: count + one tile each; an uncatalogued trophy shows its prefab id', () => {
        renderWithProviders(
            <ValheimCharacterSections character={valheimSheetFixture()} />,
        );
        const tr = section('Trophies');
        expect(
            within(tr).getByText('2 trophies collected'),
        ).toBeInTheDocument();
        expect(
            within(tr).getByRole('button', { name: 'TrophyDeer' }),
        ).toHaveAttribute('data-kind', 'unknown');
    });
});

describe('Valheim character sections (cont.) (cont.)', () => {
    it('empty sheet: §4.5 sentences, no banner (nothing to name)', () => {
        renderWithProviders(
            <ValheimCharacterSections
                character={valheimSheetFixture({
                    equipment: [],
                    skills: [],
                    trophies: [],
                    inventory: {
                        grid: { width: 8, height: 4, extraRows: [] },
                        items: [],
                    },
                })}
            />,
        );
        expect(screen.getByText('No skills recorded yet.')).toBeInTheDocument();
        expect(
            screen.getByText('No trophies collected yet.'),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('valheim-missing-catalogue')).toBeNull();
    });

    it('missing catalogue: banner names the game version; every item falls back to its prefab id', () => {
        renderWithProviders(
            <ValheimCharacterSections
                character={valheimSheetFixture({ items: {}, atlas: null })}
            />,
        );
        expect(
            screen.getByTestId('valheim-missing-catalogue'),
        ).toHaveTextContent('game version 0.220.5');
        expect(
            within(section('Equipment')).getByRole('button', {
                name: 'SwordIron, quality 3, equipped',
            }),
        ).toBeInTheDocument();
        expect(
            within(section('Inventory')).getAllByRole('gridcell'),
        ).toHaveLength(56);
    });
});

describe('Valheim inventory grid semantics', () => {
    it('is one tab stop, and its bands are labels outside the grid rows', () => {
        renderWithProviders(
            <ValheimCharacterSections character={valheimSheetFixture()} />,
        );
        const grid = screen.getByRole('grid', { name: 'Inventory' });
        expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
        for (const band of screen.queryAllByTestId('valheim-row-band')) {
            expect(band.closest('[role="row"]')).toBeNull();
            expect(band.parentElement?.getAttribute('role')).not.toBe('grid');
        }
    });
});
