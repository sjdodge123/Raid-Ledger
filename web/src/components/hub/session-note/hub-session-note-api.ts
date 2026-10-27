/**
 * ROK-1968 — the hub session-note client under core `/guilds/:id/session-note`.
 * Every response is parsed by its contract schema. `note.updatedAt` keeps its
 * microseconds and the server compares it as an exact string, so callers send
 * it back verbatim as `baseUpdatedAt` — never through `new Date()`.
 */
import {
    HubSessionNoteResponseSchema,
    type HubSessionNoteResponse,
    type PutHubSessionNoteInput,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

const noteBase = (guildId: number): string => `/guilds/${guildId}/session-note`;

/** Members + staff; 404 for visitors and non-members. */
export function fetchSessionNote(guildId: number): Promise<HubSessionNoteResponse> {
    return fetchApi(noteBase(guildId), {}, HubSessionNoteResponseSchema);
}

/** Editors: create or replace. A stale `baseUpdatedAt` is a 409 whose body carries the current note. */
export function putSessionNote(guildId: number, input: PutHubSessionNoteInput): Promise<HubSessionNoteResponse> {
    return fetchApi(noteBase(guildId), { method: 'PUT', body: JSON.stringify(input) }, HubSessionNoteResponseSchema);
}

/** Editors: clear the note for everyone (204). */
export function clearSessionNote(guildId: number): Promise<void> {
    return fetchApi<void>(noteBase(guildId), { method: 'DELETE' });
}

/** Members + editors: tick or untick one checklist row; 404 when the row (or note) is gone. */
export function tickSessionNoteItem(guildId: number, itemId: number, done: boolean): Promise<HubSessionNoteResponse> {
    return fetchApi(`${noteBase(guildId)}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ done }) }, HubSessionNoteResponseSchema);
}
