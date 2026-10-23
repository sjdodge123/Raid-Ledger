/**
 * ROK-1918 L5 — arrange-mode draft helpers: reorder, hide/show, add-at-top,
 * dirtiness, the live-region text, and the PATCH body (full order incl.
 * hidden rows, config passed through untouched).
 */
import { describe, it, expect } from 'vitest';
import type { HubWidgetPrefs } from '@raid-ledger/contract';
import type { HubLayoutEntry } from '../layout/resolve-hub-layout';
import { addRow, buildPrefsBody, moveAnnouncement, moveRow, sameDraft, toggleRow, type DraftRow } from './arrange-draft';

function entry(id: string, defaultOn = true): HubLayoutEntry {
    return { id, title: id.toUpperCase(), defaultOrder: 10, span: 1, audience: 'everyone', defaultOn };
}

const A = entry('a');
const B = entry('b');
const C = entry('c');
const OPT = entry('opt', false);

function rows(...list: [HubLayoutEntry, boolean][]): DraftRow<HubLayoutEntry>[] {
    return list.map(([e, on]) => ({ entry: e, on }));
}

const ids = (r: readonly DraftRow<HubLayoutEntry>[]): string[] => r.map((x) => x.entry.id);

describe('moveRow', () => {
    const base = rows([A, true], [B, true], [C, true]);

    it('swaps a row with the one above / below', () => {
        expect(ids(moveRow(base, 1, -1))).toEqual(['b', 'a', 'c']);
        expect(ids(moveRow(base, 1, 1))).toEqual(['a', 'c', 'b']);
    });

    it('is a no-op (same array) past either end', () => {
        expect(moveRow(base, 0, -1)).toBe(base);
        expect(moveRow(base, 2, 1)).toBe(base);
    });
});

describe('toggleRow / addRow', () => {
    it('flips only the named row', () => {
        const next = toggleRow(rows([A, true], [B, true]), 'b');
        expect(next.map((r) => r.on)).toEqual([true, false]);
    });

    it('puts an added widget at the top, shown (Q3), and never twice', () => {
        const next = addRow(rows([A, true]), OPT);
        expect(next.map((r) => [r.entry.id, r.on])).toEqual([['opt', true], ['a', true]]);
        expect(ids(addRow(next, OPT))).toEqual(['opt', 'a']);
    });
});

describe('sameDraft', () => {
    it('is false when order or visibility differs, true when both match', () => {
        const base = rows([A, true], [B, true]);
        expect(sameDraft(base, rows([A, true], [B, true]))).toBe(true);
        expect(sameDraft(base, rows([B, true], [A, true]))).toBe(false);
        expect(sameDraft(base, rows([A, true], [B, false]))).toBe(false);
    });
});

describe('moveAnnouncement', () => {
    it('names the widget and its new position out of the total', () => {
        expect(moveAnnouncement('Events', 3, 8)).toBe('Events moved to position 3 of 8.');
    });
});

describe('buildPrefsBody', () => {
    const prefs: HubWidgetPrefs = { order: ['zzz'], hidden: ['zzz'], added: [], config: { 'generic:text': { title: 'T', body: 'B' } } };

    it('writes the FULL order incl. hidden rows, hidden default-on ids and added opt-in ids', () => {
        const body = buildPrefsBody(rows([OPT, true], [A, false], [B, true]), null);
        expect(body).toEqual({ order: ['opt', 'a', 'b'], hidden: ['a'], added: ['opt'], config: {} });
    });

    it('passes the stored config through untouched and drops ids the catalog no longer has', () => {
        const body = buildPrefsBody(rows([A, true]), prefs);
        expect(body.config).toBe(prefs.config);
        expect(body.order).toEqual(['a']);
        expect(body.hidden).toEqual([]);
    });

    it('does not add an opt-in row that was switched back off', () => {
        expect(buildPrefsBody(rows([OPT, false], [A, true]), null).added).toEqual([]);
    });
});
