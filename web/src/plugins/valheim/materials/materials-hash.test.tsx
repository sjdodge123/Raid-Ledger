/** ROK-1889 — the Materials tab's open item round-trips through `#materials?item=`. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    materialsFixture,
    valheimContainerHandler,
    valheimContainersHandler,
    valheimMaterialsHandler,
} from '../../../test/mocks/valheim-materials-handlers';
import {
    materialsBaseFromHash,
    materialsHash,
    materialsItemFromHash,
} from './materials-hash';
import { ValheimMaterialsTab } from './valheim-materials-tab';

vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: () => false,
}));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

beforeEach(() => {
    window.history.replaceState(null, '', '/');
    server.use(
        valheimMaterialsHandler(materialsFixture()),
        valheimContainersHandler(),
        valheimContainerHandler(),
    );
});

describe('materialsItemFromHash / materialsHash', () => {
    it('reads the item from #materials?item=, with or without the #', () => {
        expect(materialsItemFromHash('#materials?item=Wood')).toBe('Wood');
        expect(materialsItemFromHash('materials?x=1&item=Iron_2')).toBe(
            'Iron_2',
        );
    });

    it('plain #materials, another tab, or a malformed item → null', () => {
        expect(materialsItemFromHash('#materials')).toBeNull();
        expect(materialsItemFromHash('')).toBeNull();
        expect(materialsItemFromHash('#map?item=Wood')).toBeNull();
        expect(materialsItemFromHash('#materials?item=')).toBeNull();
        expect(materialsItemFromHash('#materials?item=a%20b')).toBeNull();
    });

    it('serializes an item, and none as plain #materials', () => {
        expect(materialsHash('Wood')).toBe('#materials?item=Wood');
        expect(materialsHash(null)).toBe('#materials');
        expect(materialsItemFromHash(materialsHash('TrophyDeer'))).toBe(
            'TrophyDeer',
        );
    });
});

describe('materialsBaseFromHash / materialsHash with a base (ROK-1859)', () => {
    const KEY = 'Ab_-0123456789abcdefgh';

    it('reads a 22-char base key beside the item; malformed or absent → null', () => {
        expect(materialsBaseFromHash(`#materials?item=Wood&base=${KEY}`)).toBe(KEY);
        expect(materialsItemFromHash(`#materials?item=Wood&base=${KEY}`)).toBe('Wood');
        expect(materialsBaseFromHash('#materials?base=short')).toBeNull();
        expect(materialsBaseFromHash(`#map?base=${KEY}`)).toBeNull();
        expect(materialsBaseFromHash('#materials?item=Wood')).toBeNull();
    });

    it('serializes item and base together, either alone, or neither', () => {
        expect(materialsHash('Wood', KEY)).toBe(`#materials?item=Wood&base=${KEY}`);
        expect(materialsHash(null, KEY)).toBe(`#materials?base=${KEY}`);
        expect(materialsHash(null, null)).toBe('#materials');
    });

    it('a row click keeps the base already in the hash', async () => {
        window.history.replaceState(null, '', `/hub#materials?base=${KEY}`);
        renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        const list = await screen.findByRole('list', {
            name: 'Shared chest totals',
        });
        await userEvent.click(
            within(list).getByRole('button', { name: /Wood/ }),
        );
        expect(window.location.hash).toBe(`#materials?item=Wood&base=${KEY}`);
    });
});

describe('ValheimMaterialsTab — open item in the hash', () => {
    const holding = () => screen.queryByTestId('valheim-chests-holding');

    it('opens the "Chests holding" panel from a #materials?item= link', async () => {
        window.history.replaceState(null, '', '/hub#materials?item=Wood');
        renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        expect(
            await screen.findByTestId('valheim-chests-holding'),
        ).toHaveTextContent('Chests holding Wood');
    });

    it('a row click writes the item into the hash without a new history entry; Clear removes it', async () => {
        window.history.replaceState(null, '', '/hub#materials');
        const before = window.history.length;
        renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        const list = await screen.findByRole('list', {
            name: 'Shared chest totals',
        });
        await userEvent.click(
            within(list).getByRole('button', { name: /Wood/ }),
        );
        expect(window.location.hash).toBe('#materials?item=Wood');
        expect(window.history.length).toBe(before);
        expect(holding()).toHaveTextContent('Chests holding Wood');
        await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(window.location.hash).toBe('#materials');
        expect(holding()).not.toBeInTheDocument();
    });

    it('a hash change back to #materials?item= (Back) reopens the panel', async () => {
        window.history.replaceState(null, '', '/hub#materials');
        renderWithProviders(<ValheimMaterialsTab serverId={7} />);
        await screen.findByRole('list', { name: 'Shared chest totals' });
        expect(holding()).not.toBeInTheDocument();
        act(() => {
            window.history.replaceState(null, '', '/hub#materials?item=Wood');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        expect(holding()).toHaveTextContent('Chests holding Wood');
    });
});
