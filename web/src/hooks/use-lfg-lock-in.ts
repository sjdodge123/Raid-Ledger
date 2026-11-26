/**
 * ROK-1573 — "Lock in this event": create the event straight from an overlap
 * window (approved design H3 → H6, no `/events/new` detour).
 *
 * `POST /events` with `lfgGameId` makes the server convert the group's live
 * intents and sign its members up (lane A). The page then reads
 * `convertedEvent` off the group detail (lane B). On success every `['lfg']`
 * read (detail, overlap, board, chips, history — as `use-lfg-actions` does)
 * and every `['events']` read is invalidated.
 *
 * The event lasts at most 3 hours (operator ruling): `capLockInWindow`.
 */
import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EventResponseDto } from '@raid-ledger/contract';
import { createEvent } from '../lib/api/events-api';
import { toast } from '../lib/toast';
import { LFG_COPY } from '../pages/lfg/lfg-copy';
import { capLockInWindow } from '../pages/lfg/overlap-strip.helpers';

/** `CreateEventSchema.title` max length. */
const TITLE_MAX = 200;

/** An overlap window — ISO instants, as `LfgOverlapWindowDto` carries them. */
export interface LockInWindow {
    start: string;
    end: string;
}

export interface LockInOptions {
    /** Runs after the event exists and the reads were invalidated. */
    onSuccess?: (event: EventResponseDto) => void;
}

/** The create body — the group's game, its name as the title, the capped window. */
function lockInBody(gameId: number, gameName: string, window: LockInWindow, groupKey: string, chosenGroupKey?: string) {
    const { start, end } = capLockInWindow(window);
    return {
        gameId,
        lfgGameId: gameId,
        // ROK-2352: only that group converts; the whole-game group sends no key.
        ...(groupKey === '' ? {} : { lfgGroupKey: groupKey }),
        // The Any group's picked instance (ROK-2352 §3.4); never sent for a keyed group.
        ...(groupKey === '' && chosenGroupKey ? { lfgChosenGroupKey: chosenGroupKey } : {}),
        title: gameName.slice(0, TITLE_MAX),
        startTime: start,
        endTime: end,
    };
}

/** Create an event from the LFG group for `gameId`, converting the group. */
export function useLockInEvent(gameId: number, gameName: string, groupKey = '') {
    const queryClient = useQueryClient();
    const mutation = useMutation({
        mutationFn: ({ window, chosenGroupKey }: { window: LockInWindow; chosenGroupKey?: string | undefined }) =>
            createEvent(lockInBody(gameId, gameName, window, groupKey, chosenGroupKey)),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['lfg'] });
            void queryClient.invalidateQueries({ queryKey: ['events'] });
        },
        onError: (error: Error) =>
            toast.error(error.message || LFG_COPY.lockInFailed),
    });
    const { mutate } = mutation;
    const lockIn = useCallback(
        (window: LockInWindow, options?: LockInOptions, chosenGroupKey?: string): void =>
            mutate({ window, chosenGroupKey }, options),
        [mutate],
    );
    return { lockIn, isPending: mutation.isPending };
}
