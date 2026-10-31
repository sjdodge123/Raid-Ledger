/**
 * ROK-1814 — the crest editor routes (`/guilds/:id/crest`, L2 handover). Every
 * write answers with the fresh `GuildCrestEditorState`, parsed by its schema.
 */
import {
    GuildCrestEditorStateSchema, type GuildCrestEditorState, type SetGuildCrest, type SetGuildCrestFromGallery,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';

const base = (guildId: number): string => `/guilds/${encodePathSegment(String(guildId))}/crest`;

/** Editor-only: both stored crests, the active pointer and any staff removal. */
export function fetchGuildCrest(guildId: number): Promise<GuildCrestEditorState> {
    return fetchApi(base(guildId), {}, GuildCrestEditorStateSchema);
}

/** Show a (new) preset, the stored upload, or none. */
export function putGuildCrest(guildId: number, body: SetGuildCrest): Promise<GuildCrestEditorState> {
    return fetchApi(base(guildId), { method: 'PUT', body: JSON.stringify(body) }, GuildCrestEditorStateSchema);
}

/** Multipart `file`; the server re-encodes it and makes it the active crest. */
export function postGuildCrestUpload(guildId: number, file: File): Promise<GuildCrestEditorState> {
    const form = new FormData();
    form.append('file', file, file.name);
    return fetchApi(`${base(guildId)}/upload`, { method: 'POST', body: form }, GuildCrestEditorStateSchema);
}

/** Copy a picture from this hub's gallery into the public crest store. */
export function postGuildCrestFromGallery(guildId: number, body: SetGuildCrestFromGallery): Promise<GuildCrestEditorState> {
    return fetchApi(`${base(guildId)}/from-gallery`, { method: 'POST', body: JSON.stringify(body) }, GuildCrestEditorStateSchema);
}

/** Staff moderation: delete the stored upload. */
export function deleteGuildCrestUpload(guildId: number): Promise<GuildCrestEditorState> {
    return fetchApi(`${base(guildId)}/upload`, { method: 'DELETE' }, GuildCrestEditorStateSchema);
}
