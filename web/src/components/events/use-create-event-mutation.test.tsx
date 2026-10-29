/**
 * ROK-2032: the create form locks a poll in claim-first through one endpoint
 * (`POST /scheduling-polls/:matchId/lock-in`) instead of `createEvent` + `/complete`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CreateEventDto, EventResponseDto } from '@raid-ledger/contract';
import { completeStandalonePoll, createEvent, lockInSchedulingPoll, updateEvent } from '../../lib/api-client';
import { withHttpStatus } from '../../lib/api/api-error';
import { toast } from '../../lib/toast';
import { invalidateHubPolls } from '../hub/events/hub-polls-api';
import { FALLBACK_TOAST } from './use-bench-pick';
import { LOCK_IN_LOST_TOAST, useCreateEventMutation, type CreateEventMutationOptions } from './use-create-event-mutation';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
vi.mock('../../lib/api-client', () => ({
    createEvent: vi.fn(), updateEvent: vi.fn(), updateSeries: vi.fn(),
    lockInSchedulingPoll: vi.fn(), completeStandalonePoll: vi.fn(),
}));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../hub/events/hub-polls-api', () => ({ invalidateHubPolls: vi.fn() }));

const EVENT = { id: 77 } as EventResponseDto;
const DTO = { title: 'Raid night' } as CreateEventDto;
const LOCK: Partial<CreateEventMutationOptions> = { schedulingMatchId: 5, schedulingLineupId: 9, schedulingStartTime: '2026-11-01T20:00:00.000Z' };

function setup(opts: Partial<CreateEventMutationOptions>) {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useCreateEventMutation({ isEditMode: false, ...opts }), { wrapper });
    return { result, invalidate, qc };
}

async function submit(opts: Partial<CreateEventMutationOptions>) {
    const s = setup(opts);
    act(() => { s.result.current.mutate(DTO); });
    await waitFor(() => expect(s.result.current.isPending).toBe(false));
    return s;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('useCreateEventMutation — poll lock-in (ROK-2032)', () => {
    it('locks in through the one endpoint, never createEvent or /complete', async () => {
        vi.mocked(lockInSchedulingPoll).mockResolvedValue({ event: EVENT, benchPickFallback: false });
        const { invalidate, qc } = await submit({ ...LOCK, benchUserIds: [4, 6] });
        expect(lockInSchedulingPoll).toHaveBeenCalledTimes(1);
        expect(lockInSchedulingPoll).toHaveBeenCalledWith(5, {
            event: { ...DTO, schedulingMatchId: 5 }, startTime: LOCK.schedulingStartTime, benchUserIds: [4, 6],
        });
        expect(createEvent).not.toHaveBeenCalled();
        expect(completeStandalonePoll).not.toHaveBeenCalled();
        expect(invalidateHubPolls).toHaveBeenCalledWith(qc);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['events', 77] });
        expect(toast.warning).not.toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/events/77');
    });

    it('sends no slot or bench pick when the poll has no winning slot', async () => {
        vi.mocked(lockInSchedulingPoll).mockResolvedValue({ event: EVENT, benchPickFallback: false });
        await submit({ schedulingMatchId: 5, benchUserIds: [4] });
        expect(lockInSchedulingPoll).toHaveBeenCalledWith(5, { event: { ...DTO, schedulingMatchId: 5 } });
    });

    it('tells the organizer when the server dropped their bench pick', async () => {
        vi.mocked(lockInSchedulingPoll).mockResolvedValue({ event: EVENT, benchPickFallback: true });
        await submit({ ...LOCK, benchUserIds: [4] });
        expect(toast.warning).toHaveBeenCalledWith(FALLBACK_TOAST);
        expect(mockNavigate).toHaveBeenCalledWith('/events/77');
    });

    it('on a lost race (409) shows the Q3 copy and goes back to the poll page, not to an event', async () => {
        vi.mocked(lockInSchedulingPoll).mockRejectedValue(withHttpStatus(new Error('This poll has already been locked in'), 409));
        await submit(LOCK);
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledWith(LOCK_IN_LOST_TOAST);
        expect(LOCK_IN_LOST_TOAST).toBe('Someone else locked in this poll first. No event was created.');
        expect(mockNavigate).toHaveBeenCalledTimes(1);
        expect(mockNavigate).toHaveBeenCalledWith('/community-lineup/9/schedule/5');
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows a non-409 lock-in failure as is and stays on the form', async () => {
        vi.mocked(lockInSchedulingPoll).mockRejectedValue(withHttpStatus(new Error('Bad slot'), 400));
        await submit(LOCK);
        expect(toast.error).toHaveBeenCalledWith('Bad slot');
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});

describe('useCreateEventMutation — without a poll (unchanged)', () => {
    it('plain create calls createEvent and navigates to the new event', async () => {
        vi.mocked(createEvent).mockResolvedValue(EVENT);
        await submit({});
        expect(createEvent).toHaveBeenCalledWith(DTO);
        expect(lockInSchedulingPoll).not.toHaveBeenCalled();
        expect(invalidateHubPolls).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('Event created successfully!');
        expect(mockNavigate).toHaveBeenCalledWith('/events/77');
    });

    it('edit mode updates the event, even with a poll id present', async () => {
        vi.mocked(updateEvent).mockResolvedValue(EVENT);
        await submit({ isEditMode: true, editEventId: 77, schedulingMatchId: 5 });
        expect(updateEvent).toHaveBeenCalledWith(77, DTO);
        expect(lockInSchedulingPoll).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('Event updated!');
        expect(mockNavigate).toHaveBeenCalledWith('/events/77');
    });

    it('a 409 on plain create is shown as is, with no poll navigation', async () => {
        vi.mocked(createEvent).mockRejectedValue(withHttpStatus(new Error('Conflict'), 409));
        await submit({});
        expect(toast.error).toHaveBeenCalledWith('Conflict');
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
