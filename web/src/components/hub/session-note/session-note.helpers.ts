/**
 * ROK-1968 — pure labels for the note card (W1) and the editor's draft
 * helpers (W2: `draftOf`, `toPutBody`, `isDirty`, `itemError`, `draftError`).
 */
import {
    HUB_POST_BODY_MAX, HUB_SESSION_NOTE_ITEM_TEXT_MAX,
    type HubSessionNote, type HubSessionNoteClearAfter, type PutHubSessionNoteInput,
} from '@raid-ledger/contract';
import { syncedAgo } from '../../../lib/synced-ago';

const WHEN = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** "Session 14 · Thu 8:00 pm" — the pinned event a self-clearing note names. */
export function formatClearAfter(event: HubSessionNoteClearAfter): string {
    const when = WHEN.format(new Date(event.startTime)).replace(/\s?(AM|PM)$/, (_m, p: string) => ` ${p.toLowerCase()}`);
    return `${event.title} · ${when}`;
}

/** "Edited by Mira · 2 h ago" (ruling 1: ticks do not bump it). Display-only — never feeds `baseUpdatedAt`. */
export function editedByLine(note: Pick<HubSessionNote, 'updatedAt' | 'updatedBy'>, now: number = Date.now()): string {
    const who = note.updatedBy?.displayName ?? 'A former member';
    return `Edited by ${who} · ${syncedAgo(note.updatedAt, now)}`;
}

/** One editable checklist row. `id` null = a new row; `key` is the stable React key. */
export interface DraftItem { key: string; id: number | null; text: string }

export interface SessionNoteDraft { body: string; items: DraftItem[]; clearAfterNextEvent: boolean }

/** The editor's starting draft: the server note, or an empty one. */
export function draftOf(note: HubSessionNote | null): SessionNoteDraft {
    if (note === null) return { body: '', items: [], clearAfterNextEvent: false };
    const items = note.items.map((row) => ({ key: `id-${row.id}`, id: row.id, text: row.text }));
    return { body: note.body, items, clearAfterNextEvent: note.clearAfter !== null };
}

/** The PUT body. `baseUpdatedAt` is passed through untouched — the server compares it as an exact string. */
export function toPutBody(draft: SessionNoteDraft, baseUpdatedAt: string | null): PutHubSessionNoteInput {
    const items = draft.items.map((row) => ({ ...(row.id === null ? {} : { id: row.id }), text: row.text.trim() }));
    return { body: draft.body, items, clearAfterNextEvent: draft.clearAfterNextEvent, baseUpdatedAt };
}

/** True when the draft differs from the note it started from. */
export function isDirty(draft: SessionNoteDraft, start: SessionNoteDraft): boolean {
    if (draft.body !== start.body || draft.clearAfterNextEvent !== start.clearAfterNextEvent) return true;
    if (draft.items.length !== start.items.length) return true;
    return draft.items.some((row, i) => row.id !== start.items[i]?.id || row.text !== start.items[i]?.text);
}

export const ITEM_BLANK_ERROR = 'Add some text or remove this item';
export const ITEM_TOO_LONG_ERROR = `Keep items to ${HUB_SESSION_NOTE_ITEM_TEXT_MAX} characters`;

/** A checklist row's error, or null. */
export function itemError(text: string): string | null {
    if (text.trim() === '') return ITEM_BLANK_ERROR;
    return text.trim().length > HUB_SESSION_NOTE_ITEM_TEXT_MAX ? ITEM_TOO_LONG_ERROR : null;
}

export const EMPTY_NOTE_ERROR = 'Add a note or at least one checklist item';

/** Why Save is disabled, or null when the draft can be saved (mirrors `PutHubSessionNoteSchema`). */
export function draftError(draft: SessionNoteDraft): string | null {
    if (draft.body.length > HUB_POST_BODY_MAX) return `Keep the note to ${HUB_POST_BODY_MAX} characters`;
    if (draft.body.trim() === '' && draft.items.length === 0) return EMPTY_NOTE_ERROR;
    return draft.items.some((row) => itemError(row.text) !== null) ? 'Fix the checklist items marked below' : null;
}

let nextKey = 0;

/** Pure checklist-row edits for the items editor. */
export const itemOps = {
    add: (items: DraftItem[]): DraftItem[] => [...items, { key: `new-${++nextKey}`, id: null, text: '' }],
    remove: (items: DraftItem[], at: number): DraftItem[] => items.filter((_row, i) => i !== at),
    text: (items: DraftItem[], at: number, text: string): DraftItem[] =>
        items.map((row, i) => (i === at ? { ...row, text } : row)),
    move: (items: DraftItem[], at: number, by: -1 | 1): DraftItem[] => {
        const row = items[at];
        const to = at + by;
        if (row === undefined || to < 0 || to >= items.length) return items;
        const rest = items.filter((_r, i) => i !== at);
        return [...rest.slice(0, to), row, ...rest.slice(to)];
    },
};
