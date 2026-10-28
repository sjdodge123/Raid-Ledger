/**
 * ROK-1874: the create form opened from "Lock this time" warns when the
 * slot's yes-voters overflow the roster, and the warning follows the live
 * player-count fields without a refetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LineupRealtimeEventNames, type SchedulePollPageResponseDto, type ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { CreateEventForm } from './create-event-form';
import { completeStandalonePoll, createEvent, getSchedulePoll } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { useAuth } from '../../hooks/use-auth';
import { partialResult } from '../../test/partial-result';
import { createMockEvent } from '../../test/factories';
import { withHttpStatus } from '../../lib/api/api-error';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

type Handler = (...args: unknown[]) => void;
const handlers = new Map<string, Handler[]>();
const mockSocket = {
    emit: vi.fn(), disconnect: vi.fn(), connected: false,
    on: vi.fn((event: string, cb: Handler) => { handlers.set(event, [...(handlers.get(event) ?? []), cb]); }),
    off: vi.fn((event: string, cb: Handler) => { handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== cb)); }),
};
vi.mock('socket.io-client', () => ({ io: () => mockSocket, Socket: class {} }));
const fire = (event: string, payload: unknown) => { for (const h of handlers.get(event) ?? []) h(payload); };

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
    handlers.clear();
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
        expect(screen.getByText('Or raise the player count, or ask voters to change their vote, before you create the event.')).toBeInTheDocument();
        expect(screen.queryByText(/depends on signup order/)).not.toBeInTheDocument();
        expect(screen.queryByText(/That count includes you/)).not.toBeInTheDocument();
        expect(getSchedulePoll).toHaveBeenCalledWith(7, 5);
    });

    it('adds the "includes you" line when the creator did not vote', async () => {
        renderForm([2, 3, 4, 5]);
        expect(await screen.findByText('That count includes you — the organizer is always signed up.')).toBeInTheDocument();
    });

    it('follows Players over a smaller Max Attendees, live, with no refetch', async () => {
        renderForm([1, 2, 3, 4, 5]);
        await screen.findByTestId('scheduling-overflow-notice');
        fireEvent.change(screen.getByLabelText('Max Attendees'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Increase Players' }));
        expect(notice()).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Decrease Players' }));
        expect(notice()).toBeInTheDocument();
        expect(getSchedulePoll).toHaveBeenCalledTimes(1);
    });

    it('refreshes when another voter changes their answer while the form is open (Codex r2)', async () => {
        const poll = (ids: number[]) => partialResult<SchedulePollPageResponseDto>({ pollStatus: 'open', slots: [slot(ids)] });
        vi.mocked(getSchedulePoll).mockResolvedValue(poll([1, 2, 3, 4, 5]));
        mountForm();
        expect(await screen.findByText(/roster has 4 spots — 1 will go to the bench/)).toBeInTheDocument();
        vi.mocked(getSchedulePoll).mockResolvedValue(poll([1, 2, 3, 4, 5, 6]));
        act(() => fire(LineupRealtimeEventNames.ScheduleChanged, { lineupId: 7, matchId: 5 }));
        expect(await screen.findByText('6 people will be signed up for this time, but the roster has 4 spots — 2 will go to the bench.')).toBeInTheDocument();
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

// ─── ROK-2025: the organizer picks who goes to the bench ─────────────────────
const box = (id: number) => screen.getByTestId(`bench-pick-${id}`);
const submit = () => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Event Title' }), { target: { value: 'Game night' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
};
/** Submit, let the mutation's async start run, then assert the guard held: no POST /events, the picker scrolled into view. */
async function expectSubmitBlocked() {
    submit();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(createEvent).not.toHaveBeenCalled();
    expect(vi.mocked(window.HTMLElement.prototype.scrollIntoView).mock.contexts).toContain(screen.getByTestId('scheduling-bench-picker'));
}

describe('bench picker on the lock-in create form (ROK-2025)', () => {
    beforeEach(() => {
        vi.mocked(createEvent).mockResolvedValue(createMockEvent({ id: 77 }));
        vi.mocked(completeStandalonePoll).mockResolvedValue(undefined);
    });

    it('lists every yes-voter as a Checkbox with the LATEST marked by default', async () => {
        renderForm([1, 2, 3, 4, 5, 6]);
        const picker = await screen.findByTestId('scheduling-bench-picker');
        expect(picker.tagName).toBe('FIELDSET');
        expect(screen.getByText('Who goes to the bench')).toBeInTheDocument();
        expect(screen.getByText('The latest yes-votes are marked. Earlier voters keep their spot. Change it if you like.')).toBeInTheDocument();
        expect([2, 3, 4, 5, 6].map((id) => (box(id) as HTMLInputElement).checked)).toEqual([false, false, false, true, true]);
        expect(screen.getByRole('checkbox', { name: 'User 6' })).toBe(box(6));
        expect(screen.getByTestId('bench-pick-count')).toHaveTextContent('2 of 2 picked');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('a short pick shows the inline error and blocks the submit', async () => {
        renderForm([1, 2, 3, 4, 5]);
        await screen.findByTestId('scheduling-bench-picker');
        fireEvent.click(box(5));
        expect(screen.getByRole('alert')).toHaveTextContent('Pick 1 more for the bench.');
        expect(screen.getByTestId('bench-pick-count')).toHaveTextContent('0 of 1 picked');
        await expectSubmitBlocked();
    });

    it('an over-full pick shows the "Unmark" error and blocks the submit', async () => {
        renderForm([1, 2, 3, 4, 5]);
        await screen.findByTestId('scheduling-bench-picker');
        fireEvent.click(box(2));
        expect(screen.getByRole('alert')).toHaveTextContent('Only 1 can go to the bench. Unmark 1.');
        await expectSubmitBlocked();
    });

    it('shows every field error alongside a wrong pick, not just the pick (validateForm runs first)', async () => {
        renderForm([1, 2, 3, 4, 5]);
        await screen.findByTestId('scheduling-bench-picker');
        fireEvent.click(box(5));
        fireEvent.change(screen.getByRole('textbox', { name: 'Event Title' }), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(screen.queryByText('Title is required')).toBeInTheDocument();
        expect(screen.getByTestId('bench-pick-error')).toHaveTextContent('Pick 1 more for the bench.');
        expect(createEvent).not.toHaveBeenCalled();
    });

    it("sends the organizer's pick on lock-in", async () => {
        renderForm([1, 2, 3, 4, 5]);
        await screen.findByTestId('scheduling-bench-picker');
        fireEvent.click(box(5));
        fireEvent.click(box(2));
        submit();
        await waitFor(() => expect(completeStandalonePoll).toHaveBeenCalledWith(5, 77, START, [2]));
        expect(toast.warning).not.toHaveBeenCalled();
    });

    it('retries once without the pick when the server refuses it, and says so (D6)', async () => {
        vi.mocked(completeStandalonePoll).mockRejectedValueOnce(withHttpStatus(new Error('The votes changed'), 400)).mockResolvedValueOnce(undefined);
        renderForm([1, 2, 3, 4, 5]);
        await screen.findByTestId('scheduling-bench-picker');
        submit();
        await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
            "Event created, but the votes changed while you were choosing. The latest yes-voters went to the bench. You can move people on the event's roster.",
        ));
        expect(vi.mocked(completeStandalonePoll).mock.calls).toEqual([[5, 77, START, [5]], [5, 77, START]]);
    });

    it('sends no pick when the roster has room', async () => {
        renderForm([1, 2, 3, 4]);
        await waitFor(() => expect(getSchedulePoll).toHaveBeenCalled());
        submit();
        await waitFor(() => expect(completeStandalonePoll).toHaveBeenCalled());
        expect(vi.mocked(completeStandalonePoll).mock.calls).toEqual([[5, 77, START]]);
    });
});
