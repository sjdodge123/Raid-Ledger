/**
 * ROK-2215 — pure helpers for the Create Event plan deep-link
 * (`contentInstanceIds`, `inviteCharacterIds`) and the "Will invite" copy.
 */

/** Most characters a plan can invite (matches the invite endpoint's cap). */
export const MAX_INVITE_CHARACTERS = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comma-separated entries, trimmed, empties dropped. */
function splitList(raw: string | null): string[] {
    if (!raw) return [];
    return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** `"4,abc,-1,4"` → `[4]`: positive integers only, de-duplicated, in order. */
export function parsePositiveIntList(raw: string | null): number[] {
    const out: number[] = [];
    for (const part of splitList(raw)) {
        if (!/^\d+$/.test(part)) continue;
        const n = Number(part);
        if (Number.isSafeInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
}

/** Valid uuids only, de-duplicated, in order, capped at `max`. */
export function parseUuidList(raw: string | null, max: number = MAX_INVITE_CHARACTERS): string[] {
    const out: string[] = [];
    for (const part of splitList(raw)) {
        if (out.length >= max) break;
        const id = part.toLowerCase();
        if (UUID_RE.test(id) && !out.includes(id)) out.push(id);
    }
    return out;
}

/** "N character(s)" with the right plural. */
function characterCount(n: number): string {
    return `${n} character${n === 1 ? '' : 's'}`;
}

/** "Will invite: Aelin, Brann and 1 other character", or "Will invite 3 characters" with no names. */
export function invitePreviewText(names: string[], unresolved: number): string {
    if (names.length === 0) return `Will invite ${characterCount(unresolved)}`;
    const listed = names.join(', ');
    if (unresolved <= 0) return `Will invite: ${listed}`;
    return `Will invite: ${listed} and ${unresolved} other character${unresolved === 1 ? '' : 's'}`;
}
