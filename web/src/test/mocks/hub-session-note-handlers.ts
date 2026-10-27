/**
 * ROK-1968 — MSW fixtures for the hub "Before next session" note. The default
 * handler answers a member with no note (the card stays hidden), so hub
 * Overview specs that never look at it are unaffected. Specs `server.use()`
 * `sessionNoteGetHandler` / `sessionNoteTickHandler` with their own state.
 */
import { http, HttpResponse } from 'msw';
import type { HubSessionNote, HubSessionNoteResponse } from '@raid-ledger/contract';

export const SESSION_NOTE_URL = 'http://localhost:3000/guilds/:id/session-note';
export const SESSION_NOTE_ITEM_URL = `${SESSION_NOTE_URL}/items/:itemId`;

/** Microseconds kept on purpose: the server compares `updatedAt` as an exact string. */
export const NOTE_UPDATED_AT = '2026-10-27T10:00:00.123456Z';

export function buildSessionNote(over: Partial<HubSessionNote> = {}): HubSessionNote {
    return {
        body: 'Bring **20 potions**.',
        items: [
            { id: 1, text: 'Repair gear', done: false, doneAt: null },
            { id: 2, text: 'Finish the quest', done: true, doneAt: '2026-10-27T11:00:00.000000Z' },
        ],
        updatedAt: NOTE_UPDATED_AT,
        updatedBy: { userId: 7, displayName: 'Mira', avatarUrl: null },
        clearAfter: null,
        ...over,
    };
}

export function buildSessionNoteResponse(
    note: HubSessionNote | null,
    viewer: Partial<HubSessionNoteResponse['viewer']> = {},
): HubSessionNoteResponse {
    return { note, viewer: { canEdit: false, canTick: true, ...viewer }, nextEvent: null };
}

/** GET → `body` (status 200), or the hub-not-found 404 a visitor gets. */
export function sessionNoteGetHandler(body: HubSessionNoteResponse | 'not-found') {
    return http.get(SESSION_NOTE_URL, () => (body === 'not-found'
        ? HttpResponse.json({ statusCode: 404, message: 'Guild not found' }, { status: 404 })
        : HttpResponse.json(body)));
}

/** PATCH tick → applies `done` to `base` and echoes it, or fails with `status`. */
export function sessionNoteTickHandler(base: HubSessionNoteResponse, status = 200) {
    return http.patch(SESSION_NOTE_ITEM_URL, async ({ request, params }) => {
        if (status !== 200) return HttpResponse.json({ statusCode: status, message: 'Checklist item not found' }, { status });
        const { done } = (await request.json()) as { done: boolean };
        const id = Number(params['itemId']);
        if (base.note === null) return HttpResponse.json(base);
        const items = base.note.items.map((item) => (item.id === id ? { ...item, done } : item));
        return HttpResponse.json({ ...base, note: { ...base.note, items } });
    });
}

export const hubSessionNoteHandlers = [sessionNoteGetHandler(buildSessionNoteResponse(null))];
