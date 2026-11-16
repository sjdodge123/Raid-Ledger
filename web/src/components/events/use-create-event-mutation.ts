/**
 * The create/edit form's submit mutation. ROK-2032: a poll lock-in goes through
 * `POST /scheduling-polls/:matchId/lock-in`, which claims the poll BEFORE creating
 * the event — a losing racer gets a 409 and no event, instead of an announced
 * orphan. The roster is already filled when it returns (ROK-2031).
 */
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { CreateEventDto, EventResponseDto, InviteCharactersResultDto, LockInSchedulingPollDto, SeriesScope, UpdateEventDto } from '@raid-ledger/contract';
import { createEvent, inviteCharacters, lockInSchedulingPoll, updateEvent, updateSeries } from '../../lib/api-client';
import { isConflictError } from '../../lib/api/api-error';
import { toast } from '../../lib/toast';
import { invalidateHubPolls } from '../hub/events/hub-polls-api';
import { FALLBACK_TOAST, refreshLockedInEvent } from './use-bench-pick';

/** ROK-2032 Q3: shown to the organizer who lost a concurrent lock-in. */
export const LOCK_IN_LOST_TOAST = 'Someone else locked in this poll first. No event was created.';

/** ROK-2215 (L5): the plan's invites failed after the event itself was created. */
export const INVITES_FAILED_TOAST = 'Event created, but the invites could not be sent';

export interface CreateEventMutationOptions {
    isEditMode: boolean;
    editEventId?: number | undefined;
    seriesScope?: SeriesScope | undefined;
    /** The poll being locked in (create mode only). */
    schedulingMatchId?: number | null | undefined;
    /** The poll's lineup — its page is where a lost lock-in goes back to. */
    schedulingLineupId?: number | null | undefined;
    /** The winning slot; without one the poll just closes (no signups, no bench). */
    schedulingStartTime?: string | null | undefined;
    benchUserIds?: number[] | undefined;
    /** ROK-2215: plan characters whose owners are invited once the event exists (plain create only). */
    inviteCharacterIds?: string[] | undefined;
}

interface SubmitResult {
    event: EventResponseDto | undefined;
    benchPickFallback: boolean;
}

type FormDto = CreateEventDto | UpdateEventDto;

/** The lock-in request body; the bench pick only travels with a winning slot. */
export function buildLockInBody(dto: CreateEventDto, matchId: number, startTime: string | null | undefined, benchUserIds: number[] | undefined): LockInSchedulingPollDto {
    const event: CreateEventDto = { ...dto, schedulingMatchId: matchId };
    if (!startTime) return { event };
    return { event, startTime, ...(benchUserIds ? { benchUserIds } : {}) };
}

async function runSubmit(o: CreateEventMutationOptions, dto: FormDto): Promise<SubmitResult> {
    const isSeriesEdit = o.isEditMode && !!o.seriesScope && o.seriesScope !== 'this';
    if (isSeriesEdit && o.editEventId !== undefined && o.seriesScope) {
        await updateSeries(o.editEventId, o.seriesScope, dto as UpdateEventDto);
        return { event: undefined, benchPickFallback: false };
    }
    if (o.isEditMode && o.editEventId !== undefined) {
        return { event: await updateEvent(o.editEventId, dto as UpdateEventDto), benchPickFallback: false };
    }
    if (o.schedulingMatchId) {
        return lockInSchedulingPoll(o.schedulingMatchId, buildLockInBody(dto as CreateEventDto, o.schedulingMatchId, o.schedulingStartTime, o.benchUserIds));
    }
    return { event: await createEvent(dto as CreateEventDto), benchPickFallback: false };
}

/** Names (or a count) for one skip reason. */
function skipNames(result: InviteCharactersResultDto, reason: InviteCharactersResultDto['skipped'][number]['reason']): string {
    const rows = result.skipped.filter((r) => r.reason === reason);
    const names = rows.flatMap((r) => (r.characterName ? [r.characterName] : []));
    const unnamed = rows.length - names.length;
    return [...names, ...(unnamed > 0 ? [`${unnamed} character${unnamed === 1 ? '' : 's'}`] : [])].join(', ');
}

/** ROK-2215 ruling 5: the post-create note naming who was not invited, or null when nobody was skipped. */
export function inviteSkipNote(result: InviteCharactersResultDto): string | null {
    const parts = [
        ['Not invited (no linked Discord)', skipNames(result, 'no_discord')],
        ['Already signed up', skipNames(result, 'already_signed_up')],
        ['Not found', skipNames(result, 'not_found')],
    ].filter(([, names]) => names).map(([label, names]) => `${label}: ${names}`);
    return parts.length > 0 ? parts.join('. ') : null;
}

/** Fire-and-forget (L5): never delays navigation; the event stays whatever happens. */
function sendInvites(eventId: number, ids: string[]): void {
    void inviteCharacters(eventId, ids)
        .then((result) => { const note = inviteSkipNote(result); if (note) toast.warning(note); })
        .catch(() => { toast.error(INVITES_FAILED_TOAST); });
}

function successCopy(o: CreateEventMutationOptions): string {
    if (!o.isEditMode) return 'Event created successfully!';
    return o.seriesScope && o.seriesScope !== 'this' ? 'Series updated!' : 'Event updated!';
}

/** The form's submit mutation (see the file header). */
export function useCreateEventMutation(o: CreateEventMutationOptions): UseMutationResult<SubmitResult, Error, FormDto> {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const isLockIn = !o.isEditMode && !!o.schedulingMatchId;

    return useMutation({
        mutationFn: (dto: FormDto) => runSubmit(o, dto),
        onSuccess: ({ event, benchPickFallback }) => {
            toast.success(successCopy(o));
            void queryClient.invalidateQueries({ queryKey: ['events'] });
            if (o.isEditMode) void queryClient.invalidateQueries({ queryKey: ['event', o.editEventId] });
            if (isLockIn) {
                invalidateHubPolls(queryClient);
                refreshLockedInEvent(queryClient, event?.id);
                if (benchPickFallback) toast.warning(FALLBACK_TOAST);
            }
            const ids = o.inviteCharacterIds ?? [];
            if (!o.isEditMode && !isLockIn && event?.id && ids.length > 0) sendInvites(event.id, ids);
            navigate(`/events/${event?.id ?? o.editEventId}`);
        },
        onError: (error: Error) => {
            if (isLockIn && isConflictError(error)) {
                toast.error(LOCK_IN_LOST_TOAST);
                if (o.schedulingLineupId) navigate(`/community-lineup/${o.schedulingLineupId}/schedule/${o.schedulingMatchId}`);
                return;
            }
            toast.error(error.message || `Failed to ${o.isEditMode ? 'update' : 'create'} event`);
        },
    });
}
