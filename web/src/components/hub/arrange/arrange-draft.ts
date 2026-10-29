/**
 * ROK-1918 L5 — the arrange-mode draft: pure helpers over the resolved layout
 * (`layout/resolve-hub-layout`). A draft is the ordered list of rows the
 * leader is editing; nothing here touches React or the network.
 *
 * Saving writes the FULL order (hidden rows included — that is what lets the
 * resolver place a widget registered later next to its default neighbours,
 * spec §2.2 rule 3) and passes the hub's existing `config` through untouched.
 */
import type { HubWidgetId, HubWidgetPrefs } from '@raid-ledger/contract';
import type { ArrangedEntry, HubLayoutEntry } from '../layout/resolve-hub-layout';

export interface DraftRow<E extends HubLayoutEntry> {
    entry: E;
    /** false = hidden (default-on) / not shown (opt-in) — dimmed in place (Q2 A). */
    on: boolean;
}

export function initDraft<E extends HubLayoutEntry>(arranged: readonly ArrangedEntry<E>[]): DraftRow<E>[] {
    return arranged.map(({ entry, on }) => ({ entry, on }));
}

/** Swap row `index` with its neighbour in `dir`; out-of-range is a no-op (same array). */
export function moveRow<R>(rows: readonly R[], index: number, dir: -1 | 1): readonly R[] {
    const to = index + dir;
    const a = rows[index];
    const b = rows[to];
    if (a === undefined || b === undefined) return rows;
    const next = rows.slice();
    next[index] = b;
    next[to] = a;
    return next;
}

/**
 * Drag-and-drop (spec §2.4): take row `from` out and put it back so it ends up
 * at index `to`. Dropping on a row below lands after it, above lands before it.
 * Out-of-range or `from === to` is a no-op (same array).
 */
export function moveTo<R>(rows: readonly R[], from: number, to: number): readonly R[] {
    const row = rows[from];
    if (row === undefined || from === to || to < 0 || to >= rows.length) return rows;
    const next = rows.slice();
    next.splice(from, 1);
    next.splice(to, 0, row);
    return next;
}

export function toggleRow<E extends HubLayoutEntry>(rows: readonly DraftRow<E>[], id: HubWidgetId): DraftRow<E>[] {
    return rows.map((r) => (r.entry.id === id ? { ...r, on: !r.on } : r));
}

/** Q3: an added widget lands at the top of the list, shown. Already listed → unchanged. */
export function addRow<E extends HubLayoutEntry>(rows: readonly DraftRow<E>[], entry: E): DraftRow<E>[] {
    if (rows.some((r) => r.entry.id === entry.id)) return rows.slice();
    return [{ entry, on: true }, ...rows];
}

/** Same ids, same order, same on/off. */
export function sameDraft<E extends HubLayoutEntry>(a: readonly DraftRow<E>[], b: readonly DraftRow<E>[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((r, i) => {
        const o = b[i];
        return o !== undefined && o.entry.id === r.entry.id && o.on === r.on;
    });
}

/** "Events moved to position 3 of 8." — the polite live-region text (spec §2.4). */
export function moveAnnouncement(title: string, position: number, count: number): string {
    return `${title} moved to position ${position} of ${count}.`;
}

/**
 * PATCH body. `hidden` = default-on rows switched off; `added` = opt-in rows
 * switched on. An opt-in row switched off is simply not added (it returns to
 * the picker). Ids that are no longer in the catalog are dropped (AC3).
 */
export function buildPrefsBody<E extends HubLayoutEntry>(
    rows: readonly DraftRow<E>[],
    prefs: HubWidgetPrefs | null,
): HubWidgetPrefs {
    return {
        order: rows.map((r) => r.entry.id),
        hidden: rows.filter((r) => r.entry.defaultOn && !r.on).map((r) => r.entry.id),
        added: rows.filter((r) => !r.entry.defaultOn && r.on).map((r) => r.entry.id),
        config: prefs?.config ?? {},
    };
}
