/**
 * ROK-1297 (round 5y) — GameResearchDrawer now navigates to `/games/:id`
 * instead of rendering a side-drawer. This spec covers:
 *  - closed: no navigation
 *  - open + gameId: navigates immediately, calls onClose
 *  - open + name-only: waits for lookup, then navigates
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>(
        'react-router-dom',
    );
    return { ...actual, useNavigate: () => navigateMock };
});

const lookupMock: { data: { id: number } | undefined } = { data: undefined };
vi.mock('../../hooks/use-game-lookup-by-name', () => ({
    useGameLookupByName: () => lookupMock,
}));

import { GameResearchDrawer } from './GameResearchDrawer';

function renderDrawer(props: {
    isOpen: boolean;
    gameId?: number;
    name?: string;
}) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    const onClose = vi.fn();
    const utils = render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <GameResearchDrawer
                    isOpen={props.isOpen}
                    onClose={onClose}
                    gameId={props.gameId}
                    name={props.name}
                />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return { ...utils, onClose, client };
}

describe('GameResearchDrawer (navigate)', () => {
    beforeEach(() => {
        navigateMock.mockClear();
        lookupMock.data = undefined;
    });

    it('does nothing when closed', () => {
        renderDrawer({ isOpen: false, gameId: 42 });
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('navigates when gameId is supplied and isOpen', () => {
        const { onClose } = renderDrawer({ isOpen: true, gameId: 42 });
        expect(navigateMock).toHaveBeenCalledWith('/games/42');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('waits for name lookup then navigates', () => {
        const { rerender, onClose, client } = renderDrawer({
            isOpen: true,
            name: 'Satisfactory',
        });
        expect(navigateMock).not.toHaveBeenCalled();
        lookupMock.data = { id: 7 };
        rerender(
            <QueryClientProvider client={client}>
                <MemoryRouter>
                    <GameResearchDrawer
                        isOpen={true}
                        onClose={onClose}
                        name="Satisfactory"
                    />
                </MemoryRouter>
            </QueryClientProvider>,
        );
        expect(navigateMock).toHaveBeenCalledWith('/games/7');
    });
});
