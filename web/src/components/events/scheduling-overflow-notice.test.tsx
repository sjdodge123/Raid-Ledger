/**
 * ROK-1874: the create form opened from "Lock this time" warns when the
 * slot's yes-voters overflow the roster, and the warning follows the live
 * player-count fields without a refetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SchedulePollPageResponseDto, ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { CreateEventForm } from './create-event-form';
import { getSchedulePoll } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { partialResult } from '../../test/partial-result';
import { createMockEvent } from '../../test/factories';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../lib/api-client', () => ({
    createEvent: vi.fn(), updateEvent: vi.fn(), updateSeries: vi.fn(),
    completeStandalonePoll: vi.fn(), getSchedulePoll: vi.fn(),
}));
vi.mock('../../hooks/use-auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../../stores/timezone-store', () => ({
    useTimezoneStore: vi.fn((selector: (s: { resolved: string }) => unknown) => selector({ resolved: 'America/New_York' })),
}));
vi.mock('../../lib/timezone-utils', () => ({ getTimezoneAbbr: vi.fn(() => 'EST') }));
vi.mock('../../hooks/use-event-templates', () => ({
    useEventTemplates: vi.fn(() => ({ data: null })),
    useCreateTemplate: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useDeleteTemplate: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: vi.fn(() => ({ games: [] })),
    useEventTypes: vi.fn(() => ({ data: null })),
}));
vi.mock('../../hooks/use-want-to-play', () => ({ useWantToPlay: vi.fn(() => ({ count: 0, isLoading: false })) }));
vi.mock('../../plugins', () => ({ PluginSlot: vi.fn(() => null) }));
vi.mock('../../plugins/wow/utils', () => ({ getWowVariant: vi.fn(() => null), getContentType: vi.fn(() => null) }));
vi.mock('./game-search-input', () => ({ GameSearchInput: vi.fn(() => <div data-testid="game-search-input" />) }));

const CREATOR = 1;
const START = '2035-06-10T20:00:00.000Z';
const GAME = { id: 42, name: 'Valheim', slug: 'valheim', coverUrl: null, playerCount: { min: 1, max: 4 } };

function slot(voterIds: number[]): ScheduleSlotWithVotesDto {
    return {
        id: 9, matchId: 5, proposedTime: START, overlapScore: 0, suggestedBy: 'system',
        createdAt: '2026-05-16T00:00:00.000Z', noVotes: [],
        votes: voterIds.map((userId) => ({ userId, displayName: `User ${userId}`, avatar: null, discordId: null, customAvatarUrl: null })),
    };
}

function renderForm(voterIds: number[], props: Parameters<typeof CreateEventForm>[0] = {}) {
    vi.mocked(getSchedulePoll).mockResolvedValue(partialResult<SchedulePollPageResponseDto>({ slots: [slot(voterIds)] }));
    return mountForm(props);
}

function mountForm(props: Parameters<typeof CreateEventForm>[0] = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={qc}>
            <MemoryRouter>
                <CreateEventForm initialGame={GAME} initialStartTime={START} schedulingMatchId={5} schedulingLineupId={7} {...props} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

const notice = () => screen.queryByTestId('scheduling-overflow-notice');

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue(partialResult<ReturnType<typeof useAuth>>({
        user: partialResult<NonNullable<ReturnType<typeof useAuth>['user']>>({ id: CREATOR }),
    }));
});

describe('SchedulingOverflowNotice on the create form', () => {
    it('warns with the exact copy when yes-voters overflow a 4-spot roster', async () => {
        renderForm([1, 2, 3, 4, 5]);
        const banner = await screen.findByTestId('scheduling-overflow-notice');
        expect(banner).toHaveAttribute('role', 'status');
        expect(screen.getByText('More yes-votes than roster spots')).toBeInTheDocument();
        expect(screen.getByText('5 people will be signed up for this time, but the roster has 4 spots — 1 will go to the bench.')).toBeInTheDocument();
        expect(screen.getByText('Voted yes: User 2, User 3, User 4, User 5')).toBeInTheDocument();
        expect(screen.getByText(/Who goes to the bench depends on signup order\./)).toBeInTheDocument();
        expect(screen.queryByText(/That count includes you/)).not.toBeInTheDocument();
        expect(getSchedulePoll).toHaveBeenCalledWith(7, 5);
    });

    it('adds the "includes you" line when the creator did not vote', async () => {
        renderForm([2, 3, 4, 5]);
        expect(await screen.findByText('That count includes you — the organizer is always signed up.')).toBeInTheDocument();
    });

    it('hides when both caps are raised and returns when one is lowered, with no refetch', async () => {
        renderForm([1, 2, 3, 4, 5]);
        await screen.findByTestId('scheduling-overflow-notice');
        fireEvent.click(screen.getByRole('button', { name: 'Increase Players' }));
        expect(notice()).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Max Attendees'), { target: { value: '5' } });
        expect(notice()).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Decrease Players' }));
        expect(notice()).toBeInTheDocument();
        expect(getSchedulePoll).toHaveBeenCalledTimes(1);
    });

    it('stays hidden when the roster has room', async () => {
        renderForm([1, 2, 3, 4]);
        await waitFor(() => expect(getSchedulePoll).toHaveBeenCalled());
        expect(notice()).not.toBeInTheDocument();
    });

    it('never fetches or shows without a lineupId', () => {
        renderForm([1, 2, 3, 4, 5], { schedulingLineupId: null });
        expect(getSchedulePoll).not.toHaveBeenCalled();
        expect(notice()).not.toBeInTheDocument();
    });

    it('never fetches or shows without a matchId', () => {
        renderForm([1, 2, 3, 4, 5], { schedulingMatchId: null });
        expect(getSchedulePoll).not.toHaveBeenCalled();
        expect(notice()).not.toBeInTheDocument();
    });

    it('never fetches or shows without an initialStartTime', () => {
        renderForm([1, 2, 3, 4, 5], { initialStartTime: null });
        expect(getSchedulePoll).not.toHaveBeenCalled();
        expect(notice()).not.toBeInTheDocument();
    });

    it('never fetches or shows in edit mode', () => {
        renderForm([1, 2, 3, 4, 5], { event: createMockEvent({ id: 77 }) });
        expect(getSchedulePoll).not.toHaveBeenCalled();
        expect(notice()).not.toBeInTheDocument();
    });

    it('keeps the generic Players count at 1 or more, so the banner never hides a 0-spot roster', async () => {
        renderForm([1, 2, 3, 4, 5]);
        await screen.findByTestId('scheduling-overflow-notice');
        const decrease = screen.getByRole('button', { name: 'Decrease Players' });
        for (let i = 0; i < 5; i++) fireEvent.click(decrease);
        expect(screen.getByRole('spinbutton', { name: 'Players slots' })).toHaveValue(1);
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Players slots' }), { target: { value: '0' } });
        expect(screen.getByRole('spinbutton', { name: 'Players slots' })).toHaveValue(1);
        expect(screen.getByText('5 people will be signed up for this time, but the roster has 1 spot — 4 will go to the bench.')).toBeInTheDocument();
    });

    it('stays hidden for an MMO roster', async () => {
        renderForm([1, 2, 3, 4, 5]);
        await screen.findByTestId('scheduling-overflow-notice');
        fireEvent.click(screen.getByRole('radio', { name: 'MMO Roles' }));
        expect(notice()).not.toBeInTheDocument();
    });

    it('stays hidden when the poll fetch errors, and the form still renders', async () => {
        vi.mocked(getSchedulePoll).mockRejectedValue(new Error('boom'));
        mountForm();
        await waitFor(() => expect(getSchedulePoll).toHaveBeenCalled());
        expect(notice()).not.toBeInTheDocument();
        expect(screen.getByRole('spinbutton', { name: 'Players slots' })).toBeInTheDocument();
    });
});
