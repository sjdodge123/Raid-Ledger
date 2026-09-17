/**
 * ROK-1573/1572/1571 — the group page's writes, driven through the mounted
 * dialogs. The mutation hooks are mocked so each assertion is about WHAT the
 * page asks for (and that Cancel asks for nothing), not the network.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import {
    createMockLfgGroupDetail,
    createMockLfgIntent,
    createMockLfgMember,
    createMockOverlapWindow,
} from '../../test/lfg-factories';
import { lfgGroupPageHandlers, LFG_TEST_SLUG } from '../../test/mocks/lfg-handlers';
import { ACCESS_TOKEN_KEY } from '../../lib/api/auth-storage-keys';
import { LfgGroupPage } from './lfg-group-page';

const mocks = vi.hoisted(() => ({
    findATime: vi.fn(),
    withdraw: vi.fn(),
    lockIn: vi.fn(),
}));

vi.mock('../../hooks/use-lfg-actions', () => ({
    useFindATime: () => ({ findATime: mocks.findATime, isPending: false, pendingConvert: null, retryConvert: vi.fn() }),
    useWithdraw: () => ({ mutate: mocks.withdraw, isPending: false }),
}));
vi.mock('../../hooks/use-lfg-lock-in', () => ({
    useLockInEvent: () => ({ lockIn: mocks.lockIn, isPending: false }),
}));

const API_BASE = 'http://localhost:3000';
const CONVERTED = { eventId: 55, title: 'Deep Rock Galactic', startTime: new Date(2026, 8, 2, 20).toISOString(), signupCount: 2 };
const MEMBERS = [
    createMockLfgMember({ userId: 1, username: 'ana', displayName: 'Ana' }),
    createMockLfgMember({ userId: 2, username: 'bo', displayName: 'Bo' }),
];

function serveGroup(over: Parameters<typeof createMockLfgGroupDetail>[0] = {}) {
    server.use(
        http.get(`${API_BASE}/lfg/:gameId`, () =>
            HttpResponse.json(
                createMockLfgGroupDetail({ activeCount: 2, members: MEMBERS, ownIntent: createMockLfgIntent(), ...over }),
            ),
        ),
    );
}

function renderPage() {
    return renderWithProviders(
        <Routes>
            <Route path="/lfg/:gameSlug" element={<LfgGroupPage />} />
        </Routes>,
        { initialEntries: [`/lfg/${LFG_TEST_SLUG}`] },
    );
}

beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
    server.use(...lfgGroupPageHandlers);
    mocks.findATime.mockReset();
    mocks.withdraw.mockReset();
    mocks.lockIn.mockReset();
});

describe('LfgGroupPage — Start a scheduling poll (ROK-1572)', () => {
    it('Cancel on the confirm starts nothing', async () => {
        serveGroup();
        renderPage();

        await userEvent.click(await screen.findByTestId('lfg-hero-primary'));
        expect(screen.getAllByTestId('lfg-poll-confirm-member')).toHaveLength(2);
        await userEvent.click(screen.getByTestId('lfg-poll-confirm-cancel'));

        expect(mocks.findATime).not.toHaveBeenCalled();
        expect(screen.queryByTestId('lfg-poll-confirm')).toBeNull();
    });

    it('Start poll runs the find-a-time flow once, with the member ids', async () => {
        serveGroup();
        renderPage();

        await userEvent.click(await screen.findByTestId('lfg-hero-primary'));
        await userEvent.click(screen.getByTestId('lfg-poll-confirm-submit'));

        expect(mocks.findATime).toHaveBeenCalledTimes(1);
        const [args] = mocks.findATime.mock.calls[0];
        expect(args.gameId).toBe(7);
        expect(args.memberUserIds).toEqual(expect.arrayContaining([1, 2]));
        expect(args.proposedTime).toBeUndefined();
    });
});

describe('LfgGroupPage — ⋯ Manage', () => {
    it('opens manage and Withdraw calls the mutation for this game', async () => {
        serveGroup();
        renderPage();

        await userEvent.click(await screen.findByTestId('lfg-manage'));
        const body = await screen.findByTestId('lfg-manage-body');
        await userEvent.click(within(body).getByTestId('lfg-manage-withdraw'));

        expect(mocks.withdraw).toHaveBeenCalledTimes(1);
        expect(mocks.withdraw.mock.calls[0][0]).toBe(7);
    });

    it('keeps the +1 join entry point for a viewer with no intent', async () => {
        serveGroup({ ownIntent: null });
        renderPage();

        expect(await screen.findByTestId('lfg-join-button')).toBeInTheDocument();
        expect(screen.getByTestId('lfg-hero-primary')).toBeDisabled();
    });
});

describe('LfgGroupPage — Lock in this event (ROK-1573)', () => {
    it('confirms the row window and locks in exactly that window', async () => {
        serveGroup();
        const window = createMockOverlapWindow();
        renderPage();

        await userEvent.click(await screen.findByTestId('lfg-lockin'));
        expect(screen.getByTestId('lfg-lockin-confirm')).toBeInTheDocument();
        await userEvent.click(screen.getByTestId('lfg-lockin-confirm-submit'));

        expect(mocks.lockIn).toHaveBeenCalledTimes(1);
        expect(mocks.lockIn.mock.calls[0][0]).toEqual(window);
    });

    it('Cancel on the lock-in confirm creates nothing', async () => {
        serveGroup();
        renderPage();

        await userEvent.click(await screen.findByTestId('lfg-lockin'));
        await userEvent.click(screen.getByTestId('lfg-lockin-confirm-cancel'));

        expect(mocks.lockIn).not.toHaveBeenCalled();
    });

    it('a converted group with no hands up shows the event-set hero with Open the event', async () => {
        serveGroup({ activeCount: 0, ownIntent: null, convertedEvent: CONVERTED });
        renderPage();

        expect(await screen.findByTestId('lfg-converted-event')).toBeInTheDocument();
        const primary = screen.getByTestId('lfg-hero-primary');
        expect(primary).toHaveTextContent('Open the event');
        expect(primary).toHaveAttribute('href', '/events/55');
    });

    it('people +1 again after a lock-in → the looking hero, the poll primary and the join row come back', async () => {
        serveGroup({ activeCount: 2, ownIntent: null, convertedEvent: CONVERTED });
        renderPage();

        const primary = await screen.findByTestId('lfg-hero-primary');
        expect(primary).toHaveTextContent('Start a scheduling poll');
        expect(screen.queryByTestId('lfg-converted-event')).toBeNull();
        expect(screen.getByTestId('lfg-join-row')).toBeInTheDocument();
    });
});
