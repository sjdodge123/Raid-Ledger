/** ROK-1968 §6.4 — the editor's checklist row stays inside a phone-width BottomSheet (Codex P2). */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionNoteItemsEditor } from './session-note-items-editor';

const classesOf = (el: HTMLElement): string[] => el.className.split(/\s+/);

describe('SessionNoteItemsEditor row layout', () => {
    it('lets the item input shrink and keeps the row buttons at full size, so Remove never leaves the sheet', () => {
        render(<SessionNoteItemsEditor items={[{ key: 'a', id: null, text: 'A very long checklist item that fills the row' }]} onChange={() => undefined} />);
        const input = screen.getByTestId('session-note-item-input-0');
        // A flex child's min-width defaults to its intrinsic width (an <input> is ~20ch), which pushes
        // the buttons past a 320px sheet; `min-w-0` lets `flex-1` actually shrink it.
        expect(classesOf(input), 'the input can shrink below its intrinsic width').toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
        for (const name of ['Move item 1 up', 'Move item 1 down', 'Remove item 1']) {
            expect(classesOf(screen.getByRole('button', { name })), `${name} keeps its 44px size`).toContain('shrink-0');
        }
    });
});
