/**
 * ROK-1968 §6.2 — the note's read + write hooks, shared by the card (W1) and
 * the editor dialog (W2). Saves store the server's response verbatim in the
 * cache, so `note.updatedAt` keeps its microseconds for the next
 * `baseUpdatedAt` (the server compares it as an exact string); a tick never
 * moves `updatedAt`, so it patches only its own item.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
    HubSessionNoteSchema,
    type HubSessionNote,
    type HubSessionNoteResponse,
    type PutHubSessionNoteInput,
} from '@raid-ledger/contract';
import { errorBodyOf, httpStatusOf, isConflictError } from '../../../lib/api/api-error';
import { toast } from '../../../lib/toast';
import { clearSessionNote, putSessionNote, tickSessionNoteItem } from './hub-session-note-api';
import { sessionNoteKey, sessionNoteQuery } from './hub-session-note-query';
import { enqueueTick, isLatestTick, markTick, tickQueueKey } from './session-note-tick-queue';

export const ITEM_GONE_TOAST = 'That checklist item no longer exists';

export function useSessionNote(guildId: number) {
    return useQuery(sessionNoteQuery(guildId));
}

/** The note a 409 carried (`{ message, note }`), or undefined when the error is not a parseable conflict. */
export function conflictNoteOf(error: unknown): HubSessionNote | null | undefined {
    if (!isConflictError(error)) return undefined;
    const parsed = HubSessionNoteSchema.nullable().safeParse(errorBodyOf(error)?.['note']);
    return parsed.success ? parsed.data : undefined;
}

/** Editors: save. `conflict` is set after a 409 and carries the server's current note (null = it was cleared). */
export function useSaveSessionNote(guildId: number) {
    const client = useQueryClient();
    const mutation = useMutation({
        mutationFn: (input: PutHubSessionNoteInput) => putSessionNote(guildId, input),
        onSuccess: (data) => client.setQueryData(sessionNoteKey(guildId), data),
    });
    const conflictNote = conflictNoteOf(mutation.error);
    return { ...mutation, conflict: conflictNote === undefined ? null : { note: conflictNote } };
}

/** Editors: clear the note for everyone. */
export function useClearSessionNote(guildId: number) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => clearSessionNote(guildId),
        onSuccess: () => client.setQueryData<HubSessionNoteResponse>(sessionNoteKey(guildId),
            (prev) => (prev === undefined ? prev : { ...prev, note: null })),
    });
}

interface TickVars { itemId: number; done: boolean }
type NoteItem = HubSessionNote['items'][number];

/** Replace ONE item in the cached note (other items keep whatever later ticks wrote). */
function withItem(prev: HubSessionNoteResponse | undefined, itemId: number, patch: (item: NoteItem) => NoteItem) {
    if (prev?.note == null) return prev;
    const items = prev.note.items.map((item) => (item.id === itemId ? patch(item) : item));
    return { ...prev, note: { ...prev.note, items } };
}

function findItem(data: HubSessionNoteResponse | undefined, itemId: number): NoteItem | undefined {
    return data?.note?.items.find((item) => item.id === itemId);
}

async function applyOptimisticTick(client: QueryClient, guildId: number, { itemId, done }: TickVars) {
    const key = sessionNoteKey(guildId);
    const stamp = markTick(tickQueueKey(guildId, itemId)); // at click time, so stamps follow click order
    await client.cancelQueries({ queryKey: key });
    const previous = findItem(client.getQueryData<HubSessionNoteResponse>(key), itemId);
    client.setQueryData<HubSessionNoteResponse>(key, (prev) => withItem(prev, itemId, (item) => ({ ...item, done })));
    return { previous, stamp };
}

/**
 * Members + editors: optimistic tick. Ticks on different items overlap and answer out of order, so
 * each one only ever writes (or rolls back) its OWN item, and the last tick to settle refetches to
 * reconcile. Ticks on the SAME item are sent one at a time (`enqueueTick`), so the server applies
 * them in click order, and only the newest click on an item writes its answer or rollback to the
 * cache — an older answer would flip the box back mid-sequence. A 404 (row or note gone) also toasts.
 */
export function useTickSessionNoteItem(guildId: number) {
    const client = useQueryClient();
    const key = sessionNoteKey(guildId);
    const mutationKey = [...key, 'tick'];
    const restore = (itemId: number, item: NoteItem | undefined) => {
        if (item !== undefined) client.setQueryData<HubSessionNoteResponse>(key, (prev) => withItem(prev, itemId, () => item));
    };
    return useMutation({
        mutationKey,
        mutationFn: ({ itemId, done }: TickVars) =>
            enqueueTick(tickQueueKey(guildId, itemId), () => tickSessionNoteItem(guildId, itemId, done)),
        onMutate: (vars) => applyOptimisticTick(client, guildId, vars),
        onError: (error, { itemId }, context) => {
            if (context && isLatestTick(tickQueueKey(guildId, itemId), context.stamp)) restore(itemId, context.previous);
            if (httpStatusOf(error) === 404) toast.error(ITEM_GONE_TOAST);
        },
        onSuccess: (data, { itemId }, context) => {
            if (isLatestTick(tickQueueKey(guildId, itemId), context.stamp)) restore(itemId, findItem(data, itemId));
        },
        onSettled: () => {
            if (client.isMutating({ mutationKey }) <= 1) void client.invalidateQueries({ queryKey: key });
        },
    });
}
