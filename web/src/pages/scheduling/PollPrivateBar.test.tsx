/**
 * ROK-1750 — PollPrivateBar on the poll page: Private chip + Copy link for any
 * viewer handed a token; Reset link only for the creator / operator / admin,
 * and only after the confirm. Hidden when the poll is public or the viewer got
 * no token (a private community lineup reports private with no token).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import type { User } from '../../hooks/use-auth';
import { renderWithProviders } from '../../test/render-helpers';
import { server } from '../../test/mocks/server';
import { pollShareResetHandler } from '../../test/mocks/poll-share-handlers';
import { PollPrivateBar } from './PollPrivateBar';

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('../../hooks/use-auth', async () => {
    const actual = await vi.importActual<typeof import('../../hooks/use-auth')>('../../hooks/use-auth');
    return { ...actual, useAuth: () => ({ user: auth.user, isLoading: false }) };
});
vi.mock('../../lib/clipboard', () => ({ copyWithToast: vi.fn().mockResolvedValue(true) }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { copyWithToast } from '../../lib/clipboard';

const CREATOR_ID = 7;
function makeUser(id: number, role: User['role'] = 'member'): User {
    return {
        id, discordId: `d-${id}`, username: `u${id}`, displayName: null, avatar: null,
        customAvatarUrl: null, role, steamId: null, onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
    } as User;
}
function makePoll(overrides: Partial<SchedulePollPageResponseDto> = {}): SchedulePollPageResponseDto {
    return {
        visibility: 'private',
        shareToken: 'tok_abc',
        match: { id: 55, lineupCreatedById: CREATOR_ID },
        ...overrides,
    } as unknown as SchedulePollPageResponseDto;
}

beforeEach(() => {
    vi.clearAllMocks();
    auth.user = makeUser(99);
});

describe('PollPrivateBar (ROK-1750)', () => {
    it('renders nothing for a public poll', () => {
        renderWithProviders(<PollPrivateBar poll={makePoll({ visibility: 'public', shareToken: null })} />);
        expect(screen.queryByTestId('poll-private-bar')).toBeNull();
    });

    it('renders nothing when the poll is private but the viewer has no token', () => {
        renderWithProviders(<PollPrivateBar poll={makePoll({ shareToken: null })} />);
        expect(screen.queryByTestId('poll-private-bar')).toBeNull();
    });

    it('any participant sees the Private chip and copies the share link', async () => {
        const user = userEvent.setup();
        renderWithProviders(<PollPrivateBar poll={makePoll()} />);
        expect(screen.getByText('Private')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Copy poll link' }));
        expect(copyWithToast).toHaveBeenCalledWith(
            `${window.location.origin}/p/poll/tok_abc`, { success: 'Link copied', error: 'Failed to copy link' },
        );
    });

    it('a non-creator member gets no Reset link', () => {
        renderWithProviders(<PollPrivateBar poll={makePoll()} />);
        expect(screen.queryByTestId('poll-share-reset'), 'only the creator / admin may reset').toBeNull();
    });

    it.each([
        ['the creator', () => makeUser(CREATOR_ID)],
        ['an admin', () => makeUser(99, 'admin')],
        ['an operator', () => makeUser(99, 'operator')],
    ])('%s sees Reset link', (_who, mk) => {
        auth.user = mk();
        renderWithProviders(<PollPrivateBar poll={makePoll()} />);
        expect(screen.getByTestId('poll-share-reset')).toBeInTheDocument();
    });

    it('Reset is behind a confirm: Cancel sends nothing, confirming POSTs the reset', async () => {
        const calls: string[] = [];
        server.use(pollShareResetHandler({ shareToken: 'tok_new' }, calls));
        auth.user = makeUser(CREATOR_ID);
        const user = userEvent.setup();
        renderWithProviders(<PollPrivateBar poll={makePoll()} />);

        await user.click(screen.getByTestId('poll-share-reset'));
        expect(await screen.findByText('Reset link?')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(calls, 'opening and cancelling the confirm must not reset').toEqual([]);

        await user.click(screen.getByTestId('poll-share-reset'));
        const dialog = await screen.findByRole('dialog', { name: 'Reset link?' });
        await user.click(within(dialog).getByRole('button', { name: 'Reset link' }));
        await waitFor(() => expect(calls).toEqual(['55']));
    });
});
