/**
 * ROK-1968 — pure labels for the note card (W1); the editor's draft helpers
 * (W2: `toPutBody`, `isDirty`, `itemError`) join them here.
 */
import type { HubSessionNote, HubSessionNoteClearAfter } from '@raid-ledger/contract';
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
