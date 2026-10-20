/**
 * ROK-1870 Codex r3 — the Game box's draft text must follow the filter when
 * the selected game is cleared ("Clear all") or changed from outside.
 */
import type { JSX } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render-helpers';
import { mockDesktop } from '../test/handlers/media';
import { HubsDirectoryFilters } from './hubs-directory-filters';
import type { HubsDirectoryParams } from './use-hubs-directory';

vi.mock('../hooks/use-game-search', () => ({
    useGameSearch: () => ({ data: { data: [] }, isFetching: false }),
}));

const BASE: HubsDirectoryParams = { membership: 'all', sort: 'members' };

function filters(params: HubsDirectoryParams, gameName?: string): JSX.Element {
    return <HubsDirectoryFilters params={params} gameName={gameName} onChange={vi.fn()} isOpen onOpenChange={vi.fn()} />;
}

const gameBox = (): HTMLElement => screen.getByRole('combobox', { name: 'Game' });

beforeEach(() => mockDesktop(true));

describe('GameFilter draft text', () => {
    it('empties the box when the game filter is cleared externally', async () => {
        const view = renderWithProviders(filters({ ...BASE, gameId: 5 }, 'Valheim'));
        await userEvent.clear(gameBox());
        await userEvent.type(gameBox(), 'Valheim');
        view.rerender(filters(BASE));
        expect(gameBox()).toHaveValue('');
    });

    it('shows the new game when the filter changes externally', async () => {
        const view = renderWithProviders(filters({ ...BASE, gameId: 5 }, 'Valheim'));
        await userEvent.type(gameBox(), ' typed');
        view.rerender(filters({ ...BASE, gameId: 6 }, 'Dune'));
        expect(gameBox()).toHaveValue('Dune');
    });
});
