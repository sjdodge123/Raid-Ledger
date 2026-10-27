/** ROK-1968 §6.2 — the editor's pure draft helpers. */
import { describe, expect, it } from 'vitest';
import { buildSessionNote, NOTE_UPDATED_AT } from '../../../test/mocks/hub-session-note-handlers';
import {
    EMPTY_NOTE_ERROR, ITEM_BLANK_ERROR, ITEM_TOO_LONG_ERROR,
    draftError, draftOf, isDirty, itemError, toPutBody,
} from './session-note.helpers';
import { itemOps } from './session-note-items-editor';

describe('session-note draft helpers', () => {
    it('toPutBody keeps row ids, omits them for new rows and passes baseUpdatedAt verbatim', () => {
        const draft = draftOf(buildSessionNote());
        const withNew = { ...draft, items: [...draft.items, { key: 'n', id: null, text: '  New row ' }] };
        expect(toPutBody(withNew, NOTE_UPDATED_AT)).toEqual({
            body: 'Bring **20 potions**.',
            items: [{ id: 1, text: 'Repair gear' }, { id: 2, text: 'Finish the quest' }, { text: 'New row' }],
            clearAfterNextEvent: false,
            baseUpdatedAt: '2026-10-27T10:00:00.123456Z',
        });
    });

    it('isDirty notices a text edit and a reorder, not an untouched draft', () => {
        const start = draftOf(buildSessionNote());
        expect(isDirty(draftOf(buildSessionNote()), start)).toBe(false);
        expect(isDirty({ ...start, items: itemOps.text(start.items, 0, 'Repair all gear') }, start)).toBe(true);
        expect(isDirty({ ...start, items: itemOps.move(start.items, 0, 1) }, start)).toBe(true);
    });

    it('itemError flags blank and over-200 rows only', () => {
        expect(itemError('   ')).toBe(ITEM_BLANK_ERROR);
        expect(itemError('x'.repeat(201))).toBe(ITEM_TOO_LONG_ERROR);
        expect(itemError('x'.repeat(200))).toBeNull();
    });

    it('draftError mirrors the PUT schema: empty note, body over 4000, a bad row', () => {
        const empty = draftOf(null);
        expect(draftError(empty)).toBe(EMPTY_NOTE_ERROR);
        expect(draftError({ ...empty, body: 'x'.repeat(4001) })).toMatch(/4000/);
        expect(draftError({ ...empty, items: [{ key: 'a', id: null, text: '' }] })).not.toBeNull();
        expect(draftError({ ...empty, body: 'x'.repeat(4000) })).toBeNull();
    });

    it('itemOps.move swaps neighbours and ignores moves past either end', () => {
        const items = draftOf(buildSessionNote()).items;
        expect(itemOps.move(items, 1, -1).map((r) => r.id)).toEqual([2, 1]);
        expect(itemOps.move(items, 0, -1)).toBe(items);
        expect(itemOps.move(items, 1, 1)).toBe(items);
    });
});
